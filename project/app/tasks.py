from celery import shared_task


@shared_task()
def run_thumbnail_task(render_data, hip_path, generate_for_rop=False):
    from app.api import background_render
    background_render.generate_thumbnail(render_data=render_data,
                                         hip_path=hip_path,
                                         generate_for_rop=generate_for_rop)


@shared_task()
def run_render_task(render_data, hip_path):
    from app.api import background_render
    background_render.render_glb(render_data=render_data, hip_path=hip_path)


@shared_task()
def execute_render_rop(render_data, hip_path, generate_thumbnail=False):
    from app.api import background_render
    # Execute a single frame of the ROP as a .png for use with thumbnail.
    # Could be optimized with OpenImageIO, but can revisit that later.
    if generate_thumbnail:
        background_render.render_rop(render_data=render_data, hip_path=hip_path, force_png=True)

    # Then actually fire off the full ROP with original file extension.
    background_render.render_rop(render_data=render_data, hip_path=hip_path)
