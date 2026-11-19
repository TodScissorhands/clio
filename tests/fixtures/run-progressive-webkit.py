"""Run the progressive PDF probe in WebKitGTK and report process peak RSS."""
import json
import resource
import sys

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
    result = json.loads(message.get_js_value().to_string())
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
deadline = GLib.timeout_add_seconds(180, timeout)
Gtk.main()
GLib.source_remove(deadline)
window.destroy()
result["webviewProcessPeakRssKiB"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
print(json.dumps(result), flush=True)
sys.exit(0 if result.get("passed") else 1)
