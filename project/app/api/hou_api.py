def enableHouModule():
    import sys, os
    if hasattr(sys, "setdlopenflags"):
        old_dlopen_flags = sys.getdlopenflags()
        sys.setdlopenflags(old_dlopen_flags | os.RTLD_GLOBAL)
    try:
        import hou
    except ImportError:
        # If the hou module could not be imported, then add
        # $HFS/houdini/pythonX.Ylibs to sys.path so Python can locate the hou module.
        sys.path.append(os.environ['HHP'])
        import hou
    finally:
        # Reset dlopen flags back to their original value.
        if hasattr(sys, "setdlopenflags"):
            sys.setdlopenflags(old_dlopen_flags)

enableHouModule()
import hou

import os
import redis
import zipfile
import threading
import urllib.parse

from flask import request
from flask_socketio import join_room

from app import socketio, tasks

GLTF_ROP = "thumbnail_gltf1_webrender"
ICON_ZIP_PATH = hou.text.expandString("${HFS}/houdini/config/Icons/icons.zip")
_icon_mapping = {}
_redis_thread = None


@socketio.on('connect')
def on_connect():
    pass


def scan_and_display_nodes(parent_node, load=True, hip_file=None):
    if load:
        hou.hipFile.load(hip_file,
                         suppress_save_prompt=True,
                         ignore_load_warnings=True)
    obj_dict = process_hip_for_node_structure(hou.node(parent_node))
    return obj_dict


def process_hip_for_node_structure(root_node):
    category_name = root_node.childTypeCategory().name()
    start, end = hou.playbar.playbackRange()
    node_dict = {
        "elements": [],
        "start": start,
        "end": end,
        "category": category_name,
        "parent_icons": {}
    }

    with zipfile.ZipFile(ICON_ZIP_PATH) as zip_file:
        contents = zip_file.namelist()

        # Store the parent icon for use in the top context bar.
        current_node = root_node
        while current_node.parent():
            locate_and_store_icon(contents,
                                  current_node.name(),
                                  current_node.type().icon(),
                                  zip_file,
                                  node_dict,
                                  parent=True)
            current_node = current_node.parent()

        for node in root_node.children():
            node_info = {
                "data": {
                    "id": node.name(),
                    "path": node.path(),
                    "node_type": node.type().name(),
                    "category": str(node.type().nameWithCategory()).lower(),
                    "color": convert_rgb01_to_rgb255(node.color().rgb()),
                    "cooktime": get_last_cooktime(node),
                    "can_enter": can_enter_node(node)
                }
            }

            # Sometimes this node_type folder convention doesn't hold.
            # IconMapping file displays mapping for name -> file location.
            # (e.g.) SOP_null := COMMON_null
            node_icon = node.type().icon()
            locate_and_store_icon(contents, "", node_icon, zip_file, node_info)

            node_dict["elements"].append(node_info)
            for output in node.outputs():
                edge_info = {
                    "data": {
                        "id": "{0}-{1}".format(node.name(), output.name()),
                        "source": node.name(),
                        "target": output.name()
                    }
                }
                node_dict["elements"].append(edge_info)
    return node_dict


def locate_and_store_icon(contents,
                          node_name,
                          node_icon,
                          zip_file,
                          node_dict,
                          parent=False):
    global _icon_mapping

    node_type_folder, svg_name = node_icon.split("_", 1)
    icon_path = os.path.join(node_type_folder, svg_name + '.svg')

    if icon_path not in contents:
        if not _icon_mapping:
            load_icon_mappings(zip_file)
        mapped_name = _icon_mapping.get(node_icon)
        if mapped_name:
            node_type_folder, new_name = mapped_name.split("_", 1)
            icon_path = os.path.join(node_type_folder, new_name + '.svg')

    if icon_path in contents:
        with zip_file.open(icon_path) as icon:
            icon_content = icon.read()
            escaped_content = urllib.parse.quote(icon_content, safe="")
            svg_xml = "data:image/svg+xml;utf8,{0}".format(escaped_content)
            if not parent:
                node_dict["data"]["icon"] = svg_xml
            else:
                node_dict["parent_icons"][node_name] = svg_xml


def submit_node_for_render(node_path, gltf_file, thumbnail_path, frame_tuple):
    global _redis_thread
    render_node = hou.node(node_path)
    if not render_node:
        return False

    if render_node.type().category().name() != 'Sop':
        if not render_node.displayNode():
            return False

    out_node = hou.node("/out/{0}".format(GLTF_ROP))
    if not out_node:
        out_node = hou.node("/out").createNode("gltf")
        out_node.setName(GLTF_ROP)

    # Setup the GLTF ROP Node.
    out_node.parm("trange").set("normal")
    out_node.parm("usesoppath").set(True)
    out_node.parm("soppath").set(node_path)
    out_node.parm('file').set(gltf_file)

    print("Rendering to: {0}".format(gltf_file))

    # Directly set, rather than passing `frame_range` in render call
    # Useful to query "f2" to determine progress in callback.
    for i in range(3):
        index_str = str(i + 1)
        f_parm = out_node.parm("f{0}".format(index_str))
        f_parm.deleteAllKeyframes()
        f_parm.set(frame_tuple[i])

    out_node.addRenderEventCallback(update_progress)
    out_node.render()
    out_node.removeRenderEventCallback(update_progress)

    # Spin up a separate instance to submit background thumbnail render.
    # A bit painful to set up Docker to support GPU rendering with OpenGL.
    # Hopefully not too bad to just render with CPU via Karma?

    if not _redis_thread:
        thread = threading.Thread(target=listen_to_redis)
        thread.start()

    hip_path = hou.hipFile.path()
    print("Firing off task delay...")
    result = tasks.run_task.delay(hip_path, node_path, thumbnail_path)
    return True


def listen_to_redis():
    """
    """
    redis_client = redis.Redis(host='redis', port=6379, db=0)
    pubsub = redis_client.pubsub()
    pubsub.subscribe('render_completion_channel')

    for message in pubsub.listen():
        if message['type'] == 'message':
            print("Received:", message['data'])


def update_progress(rop_node, render_event_type, time):
    # Update the correct loading bar with "data-node-name" attribute via `nodeName`.
    if render_event_type == hou.ropRenderEventType.PostFrame:
        render_node = rop_node.parm("soppath").evalAsNode()
        endFrame = rop_node.parm("f2").evalAsFloat()
        progress = (hou.intFrame() / endFrame) * 100.0
        socketio.emit('progress_update', {
            'nodeName': render_node.name(),
            'progress': progress
        })


def load_icon_mappings(zip_file):
    global _icon_mapping
    with zip_file.open("IconMapping") as mapping:
        for line in mapping:
            decoded_line = line.decode('utf-8').rstrip('\n')
            if not decoded_line:
                continue
            mapping_line = [
                x.strip(" \t\n\r;") for x in decoded_line.split(":=")
                if not x.startswith("#")
            ]
            if len(mapping_line) == 2:
                from_name, to_name = mapping_line
                _icon_mapping[from_name] = to_name


def convert_rgb01_to_rgb255(color):
    r, g, b = color
    red = round(r * 255)
    green = round(g * 255)
    blue = round(b * 255)

    return red, green, blue


def can_enter_node(node):
    return len(node.children()) > 0


def get_last_cooktime(node):
    cached_data = node.cachedUserDataDict()
    if "cook_time" not in cached_data:
        return None
