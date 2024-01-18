# Background Rendering
class BackgroundRenderType(object):
    thumbnail = "thumb"
    glb_file = "glb"


class PublishChannels(object):
    render_completion = "render_completion_channel"
    thumb_progress = "thumb_progress_channel"
    glb_progress = "glb_progress_channel"


THUMBNAIL_CAM = "thumbnail_cam1_webrender"
THUMBNAIL_ROP = "thumbnail_karma1_webrender"
GLB_ROP = "preview_glb1_webrender"
DEFAULT_RES = 512

# Houdini API
ICON_ZIP_PATH = "${HFS}/houdini/config/Icons/icons.zip"
