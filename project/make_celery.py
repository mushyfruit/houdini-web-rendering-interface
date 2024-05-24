import os
from app import create_app

# Ensure that the celery workers spawn, not fork!
# Using preforking behavior with celery doesn't play nice with OpenCL.
# https://stackoverflow.com/questions/40615795/pathos-enforce-spawning-on-linux
os.environ["FORKED_BY_MULTIPROCESSING"] = "1"
if os.name != "nt":
    from billiard import context
    context._force_start_method("spawn")

flask_app = create_app()
celery_app = flask_app.extensions["celery"]
