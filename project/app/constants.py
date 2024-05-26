from collections import namedtuple
import os


class BackgroundRenderType(object):
    thumbnail = "thumb"
    glb_file = "glb"
    rop_render = "rop"


class PublishChannels(object):
    render_completion = "render_completion_channel"
    thumb_progress = "thumb_progress_channel"
    glb_progress = "glb_progress_channel"
    node_render_update = "node_render_progress_channel"
    node_thumb_update = "node_thumb_progress_channel"
    node_render_finished = "node_render_finish_channel"
    node_thumb_finished = "node_thumb_finish_channel"
    render_rop_finished = "render_rop_finish_channel"


class RenderTaskStruct(
    namedtuple(
        "RenderTaskStruct",
        "node_path glb_path thumbnail_path start end step file_uuid socket_id export_settings")):
    """Immutable data struct defining necessary fields to perform the
    render task.

    """
    __slots__ = ()


# These need to be expanded on, esp. for 3rd party rendering.
FILE_OUTPUT_PARMS = ["vm_picture", "picture", "sopoutput", "filename", "file"]

# These need to be expanded on, esp. for 3rd party rendering.
ROP_THUMBNAIL_REQUIRED_PARMS = ["vm_picture", "picture"]

CURRENT_FILE_UUID = 'current_file_uuid'
THUMBNAIL_EXT = "png"
THUMBNAIL_CAM = "thumbnail_cam1_webrender"
THUMBNAIL_ROP = "thumbnail_karma1_webrender"
GLB_ROP = "preview_glb1_webrender"
DEFAULT_RES = 512

ICON_ZIP_PATH = "${HFS}/houdini/config/Icons/icons.zip"

DEFAULT_PARENT_CONTEXTS = ["/obj", "/out"]
UNCOOKABLE_NODE_TYPES = ["cam", "bone", "light"]

BASE_DIR = "/var/model_storage"
STATIC_FOLDER = os.path.join(BASE_DIR, 'static')
USER_RENDER_DIR = os.path.join(STATIC_FOLDER, 'user_renders')
USER_THUMB_DIR = os.path.join(STATIC_FOLDER, 'user_thumbnails')
USER_RENDER_ROUTE = os.path.join('static', 'user_renders')
