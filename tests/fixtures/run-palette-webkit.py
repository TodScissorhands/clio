"""Run the shared React palette integration fixture in an offscreen WebKitGTK view."""
import json
import sys
import os
import subprocess

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2

result = {"passed": False, "error": "WebKit runtime test timed out"}
window = Gtk.OffscreenWindow()
window.set_default_size(1000, 700)
manager = WebKit2.UserContentManager()
manager.register_script_message_handler("test")
view = WebKit2.WebView(user_content_manager=manager)
window.add(view)


def receive(_manager, message):
    global result
    payload = json.loads(message.get_js_value().to_string())
    if "nativeDrag" in payload:
        native = Gtk.Window()
        native.set_default_size(*window.get_size())
        window.remove(view)
        native.add(view)
        native.show_all()
        view.grab_focus()
        def drag_ready(widget, response, _data=None):
            point = json.loads(widget.evaluate_javascript_finish(response).to_string())
            xid = str(native.get_window().get_xid())
            x, y, dy = map(lambda value: str(round(value)), point[:3])
            subprocess.run(["xdotool", "windowfocus", "--sync", xid, "mousemove", "--window", xid, x, y,
                "mousedown", "1", "sleep", "0.1", "mousemove", "--window", xid, x, dy,
                "sleep", "0.1", "mouseup", "1"], check=True)
            def drag_observed(widget, response, _data=None):
                widget.evaluate_javascript_finish(response)
                native.remove(view)
                window.add(view)
                window.show_all()
                native.destroy()
                view.evaluate_javascript("window.__snapshotDone=true", -1, None, None, None, None, None)
                return GLib.SOURCE_REMOVE
            def finish_drag():
                view.evaluate_javascript("window.__nativeDragResult={before:" + str(point[3]) + ",after:document.querySelector('.command-palette').getBoundingClientRect().top,focus:document.activeElement.className,delta:window.__dragLast-window.__dragStart}", -1, None, None, None, drag_observed, None)
                return GLib.SOURCE_REMOVE
            GLib.timeout_add(150, finish_drag)
        def begin_drag():
            view.evaluate_javascript("(()=>{const h=document.querySelector('.command-prompt');h.addEventListener('pointerdown',e=>window.__dragStart=e.clientY,{once:true});h.addEventListener('pointermove',e=>window.__dragLast=e.clientY);let r=h.getBoundingClientRect();return JSON.stringify([(r.right-3)*devicePixelRatio,(r.top+8)*devicePixelRatio,(r.top+68)*devicePixelRatio,document.querySelector('.command-palette').getBoundingClientRect().top])})()", -1, None, None, None, drag_ready, None)
            return GLib.SOURCE_REMOVE
        GLib.timeout_add(150, begin_drag)
    elif "nativeKey" in payload:
        native = Gtk.Window()
        native.set_default_size(800, 600)
        window.remove(view)
        native.add(view)
        native.show_all()
        view.grab_focus()
        def deliver():
            subprocess.run(["xdotool", "windowfocus", "--sync", str(native.get_window().get_xid()), "key", "--clearmodifiers", payload["nativeKey"]], check=True)
            def acknowledge():
                native.remove(view)
                window.add(view)
                window.show_all()
                native.destroy()
                view.evaluate_javascript("window.__snapshotDone=true", -1, None, None, None, None, None)
                return GLib.SOURCE_REMOVE
            GLib.timeout_add(100, acknowledge)
            return GLib.SOURCE_REMOVE
        GLib.timeout_add(100, deliver)
    elif "snapshot" in payload:
        directory = "/tmp/clio-index-evidence"
        os.makedirs(directory, exist_ok=True)
        def captured(widget, result, _data=None):
            surface = widget.get_snapshot_finish(result)
            surface.write_to_png(os.path.join(directory, payload["snapshot"]))
            widget.evaluate_javascript("window.__snapshotDone=true", -1, None, None, None, None, None)
        view.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, captured, None)
    elif "resize" in payload:
        width, height = payload["resize"]
        window.set_size_request(round(width * payload["scale"]), round(height * payload["scale"]))
        window.set_default_size(round(width * payload["scale"]), round(height * payload["scale"]))
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
deadline = GLib.timeout_add_seconds(int(sys.argv[2]) if len(sys.argv) > 2 else 80, timeout)
Gtk.main()
GLib.source_remove(deadline)
window.destroy()
print(json.dumps(result), flush=True)
sys.exit(0 if result.get("passed") else 1)
