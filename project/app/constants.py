from collections import namedtuple


class BackgroundRenderType(object):
    thumbnail = "thumb"
    glb_file = "glb"


class PublishChannels(object):
    render_completion = "render_completion_channel"
    thumb_progress = "thumb_progress_channel"
    glb_progress = "glb_progress_channel"
    node_render_update = "node_render_progress_channel"
    node_thumb_update = "node_thumb_progress_channel"
    node_render_finished = "node_render_finish_channel"
    node_thumb_finished = "node_thumb_finish_channel"


class RenderTaskStruct(
        namedtuple(
            "RenderTaskStruct",
            "node_path glb_path thumbnail_path start end step file_uuid socket_id")):
    """Immutable data struct defining necessary fields to perform the
    render task.

    """
    __slots__ = ()


CURRENT_FILE_UUID = 'current_file_uuid'
THUMBNAIL_EXT = "png"
THUMBNAIL_CAM = "thumbnail_cam1_webrender"
THUMBNAIL_ROP = "thumbnail_karma1_webrender"
GLB_ROP = "preview_glb1_webrender"
DEFAULT_RES = 512

ICON_ZIP_PATH = "${HFS}/houdini/config/Icons/icons.zip"
UNCOOKABLE_NODE_TYPES = ["cam", "bone", "light"]