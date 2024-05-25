def enable_hou_module():
    import os
    import sys
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


enable_hou_module()
import hou

import os
import zipfile
import threading
import urllib.parse

from app import tasks, constants as cnst
from app.api import socket_update

_icon_mapping = {}
_redis_thread = None


def scan_and_display_nodes(parent_node, load=True, hip_file=None):
    if load:
        # Avoid cooking the file, only need to retrieve node graph.
        hou.setUpdateMode(hou.updateMode.Manual)
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
        "parent_icons": {},
        "can_cook_all": _current_context_cookable(root_node),
    }

    icon_zip_path = hou.text.expandString(cnst.ICON_ZIP_PATH)
    with zipfile.ZipFile(icon_zip_path) as zip_file:
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
                    "can_enter": can_enter_node(node),
                    "can_cook": list(is_node_cookable(node, root_node.childTypeCategory()))
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
        else:
            # Some icons are missing from the SideFX provided icon mapping :(
            # (e.g. measure 2.0 node indicates SOP_measure-2.0, but that doesn't exist.
            # Attempt to strip node version number and check directly for base version.
            if "-" in icon_path:
                base_icon_name = icon_path.split("-")[0]
                potential_paths = [name for name in contents if name.startswith(base_icon_name)]
                if base_icon_name in potential_paths:
                    icon_path = base_icon_name + ".svg"
                elif potential_paths:
                    icon_path = potential_paths[0]


    if icon_path in contents:
        with zip_file.open(icon_path) as icon:
            icon_content = icon.read()
            escaped_content = urllib.parse.quote(icon_content, safe="")
            svg_xml = "data:image/svg+xml;utf8,{0}".format(escaped_content)
            if not parent:
                node_dict["data"]["icon"] = svg_xml
            else:
                node_dict["parent_icons"][node_name] = svg_xml


def submit_node_for_render(render_struct):
    """
    """
    global _redis_thread
    if not _redis_thread:
        _redis_thread = threading.Thread(
            target=socket_update.listen_to_celery_workers)
        _redis_thread.start()

    hip_path = hou.hipFile.path()

    # Celery automatically serializes arguments via JSON.
    # Ensure we first convert the RenderStruct to dictionary.

    # Run the .glb render background process.
    tasks.run_render_task.delay(render_struct._asdict(), hip_path)

    # Run the thumbnail background process.
    tasks.run_thumbnail_task.delay(render_struct._asdict(), hip_path)

    return True


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


def is_node_cookable(node, parent_category_name):
    if parent_category_name == hou.sopNodeTypeCategory():
        # Possible that no valid render geometry is found
        # but let the users render anyway.
        return True, ''

    if parent_category_name == hou.objNodeTypeCategory():
        # Perform basic validation:
        node_type_name = node.type().name()
        if node.type().isManager() and node.type().name() != "objnet":
            error_msg = "Unable to render manager node type {0}.".format(node_type_name.capitalize())
            return False, error_msg

        render_node = node.renderNode()
        if render_node is None:
            error_msg = "{0} does not contain a valid render node.".format(node.name())
            return False, error_msg

        if render_node.geometry() is None:
            error_msg = ("{0} does not contain a render node "
                         "with valid geometry.").format(node.name())
            return False, error_msg

        error_msg = "{0} is an uncookable node type.".format(node_type_name.capitalize())
        for uncookable_type in cnst.UNCOOKABLE_NODE_TYPES:
            if uncookable_type in node_type_name:
                return False, error_msg

        return True, ''

    # Only OBJ and SOPs are supported ATM.
    error_msg = "Only OBJ and SOP context nodes are renderable."
    return False, error_msg


def _current_context_cookable(context_node):
    """Resolves if the node is a viable target for the 'Render Context' button.
    """
    if context_node.type().isManager():
        return context_node.type().name() in {"objnet", "obj"}
    return True
