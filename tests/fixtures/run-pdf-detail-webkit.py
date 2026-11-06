"""Feature-owned real WebKit runner with compositor (including SVG) pixel reads."""
import ctypes
from ctypes.util import find_library
import json
import sys

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2

# WebKit's snapshot is a Cairo surface. Call the public C APIs directly so
# snapshot pixels do not require the optional PyGObject/Pycairo converter.
webkit = ctypes.CDLL(find_library("webkit2gtk-4.1") or "libwebkit2gtk-4.1.so.0")
cairo = ctypes.CDLL(find_library("cairo") or "libcairo.so.2")
glib = ctypes.CDLL(find_library("glib-2.0") or "libglib-2.0.so.0")


class GError(ctypes.Structure):
    _fields_ = [("domain", ctypes.c_uint), ("code", ctypes.c_int),
                ("message", ctypes.c_char_p)]


capsule_name = ctypes.pythonapi.PyCapsule_GetName
capsule_name.argtypes = [ctypes.py_object]
capsule_name.restype = ctypes.c_char_p
capsule_pointer = ctypes.pythonapi.PyCapsule_GetPointer
capsule_pointer.argtypes = [ctypes.py_object, ctypes.c_char_p]
capsule_pointer.restype = ctypes.c_void_p
webkit.webkit_web_view_get_snapshot_finish.argtypes = [
    ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.POINTER(GError))]
webkit.webkit_web_view_get_snapshot_finish.restype = ctypes.c_void_p
glib.g_error_free.argtypes = [ctypes.POINTER(GError)]
glib.g_error_free.restype = None
for name, result_type in [
    ("cairo_surface_status", ctypes.c_int),
    ("cairo_surface_get_type", ctypes.c_int),
    ("cairo_image_surface_get_format", ctypes.c_int),
    ("cairo_image_surface_get_width", ctypes.c_int),
    ("cairo_image_surface_get_height", ctypes.c_int),
    ("cairo_image_surface_get_stride", ctypes.c_int),
    ("cairo_image_surface_get_data", ctypes.c_void_p),
    ("cairo_surface_flush", None),
    ("cairo_surface_destroy", None),
]:
    function = getattr(cairo, name)
    function.argtypes = [ctypes.c_void_p]
    function.restype = result_type


def gobject_pointer(obj):
    capsule = obj.__gpointer__
    pointer = capsule_pointer(capsule, capsule_name(capsule))
    if not pointer:
        raise ValueError("PyGObject capsule contains a null native pointer")
    return pointer

result = {"passed": False, "error": "PDF detail runtime timed out"}
window = Gtk.Window()
window.set_default_size(900, 650)
manager = WebKit2.UserContentManager()
manager.register_script_message_handler("test")
view = WebKit2.WebView(user_content_manager=manager)
window.add(view)


def snapshot_finished(webview, response, request):
    surface = None
    error = ctypes.POINTER(GError)()
    try:
        surface = webkit.webkit_web_view_get_snapshot_finish(
            gobject_pointer(webview), gobject_pointer(response), ctypes.byref(error))
        if error:
            raise RuntimeError(error.contents.message.decode("utf-8", errors="replace"))
        if not surface:
            raise RuntimeError("WebKit returned no compositor snapshot")
        status = cairo.cairo_surface_status(surface)
        if status:
            raise RuntimeError(f"Cairo snapshot error status {status}")
        if cairo.cairo_surface_get_type(surface) != 0:  # CAIRO_SURFACE_TYPE_IMAGE
            raise RuntimeError("WebKit snapshot is not a Cairo image surface")
        image_format = cairo.cairo_image_surface_get_format(surface)
        if image_format not in (0, 1):  # CAIRO_FORMAT_ARGB32 / CAIRO_FORMAT_RGB24
            raise RuntimeError(f"Unsupported Cairo snapshot format {image_format}")
        cairo.cairo_surface_flush(surface)
        width = cairo.cairo_image_surface_get_width(surface)
        height = cairo.cairo_image_surface_get_height(surface)
        stride = cairo.cairo_image_surface_get_stride(surface)
        data = cairo.cairo_image_surface_get_data(surface)
        if not data or width <= 0 or height <= 0 or stride < width * 4:
            raise RuntimeError("Cairo snapshot has invalid image backing")
        # Snapshot dimensions are backing pixels, JS points are CSS pixels.
        sx = width / request["width"]
        sy = height / request["height"]
        pixels = []
        for point in request["points"]:
            x, y = round(point[0] * sx), round(point[1] * sy)
            if not (0 <= x < width and 0 <= y < height):
                raise ValueError("snapshot point outside visible surface")
            # Cairo ARGB32/RGB24 words use native byte order on every platform.
            word = ctypes.c_uint32.from_address(data + y * stride + x * 4).value
            r, g, b = (word >> 16) & 255, (word >> 8) & 255, word & 255
            a = (word >> 24) & 255 if image_format == 0 else 255
            pixels.append([r, g, b, a])
        payload = {"id": request["snapshot"], "pixels": pixels}
    except Exception as exception:
        payload = {"id": request["snapshot"], "error": str(exception)}
    finally:
        if error:
            glib.g_error_free(error)
        if surface:
            cairo.cairo_surface_destroy(surface)
    view.evaluate_javascript("window.__detailSnapshot(" + json.dumps(payload) + ")", -1, None, None, None, None, None)


def receive(_manager, message):
    global result
    payload = json.loads(message.get_js_value().to_string())
    if "snapshot" in payload:
        view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE,
                          None, snapshot_finished, payload)
    else:
        result = payload
        Gtk.main_quit()


def failed(_view, _event, _uri, error):
    global result
    result = {"passed": False, "error": str(error)}
    Gtk.main_quit()
    return False


def timeout():
    Gtk.main_quit()
    return GLib.SOURCE_REMOVE


manager.connect("script-message-received::test", receive)
view.connect("load-failed", failed)
window.show_all()
view.load_uri(sys.argv[1])
deadline = GLib.timeout_add_seconds(105, timeout)
Gtk.main()
if GLib.MainContext.default().find_source_by_id(deadline):
    GLib.source_remove(deadline)
window.destroy()
print(json.dumps(result), flush=True)
sys.exit(0 if result.get("passed") else 1)
