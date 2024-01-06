from celery import shared_task


@shared_task()
def run_thumbnail_task(render_data, hip_path):
    from app.api import background_render
    background_render.generate_thumbnail(render_data=render_data,
                                         hip_path=hip_path)


@shared_task()
def run_render_task(render_data, hip_path):
    from app.api import background_render
    background_render.render_glb(render_data=render_data, hip_path=hip_path)
