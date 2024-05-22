# Houdini Web Rendering App

A user-friendly web interface combining `BabylonJS`, `CytoscapeJS`, and
the Houdini Python API. Allows for upload, examination, rendering, and display of nodes
within a .hip file all through a web interface.

# Quick Start Guide

1. Set up API-Key licensing.
   - Generate a "Client ID" and "Client Secret" following these [steps](https://www.sidefx.com/docs/api/credentials/index.html).
   - These variables will be used for [login licensing](https://www.sidefx.com/docs/houdini/ref/utils/hkey.html#api_key_licensing) without requiring the user to login.
2. Create a `.env` file with the following keys:


    SIDEFX_CLIENT="YOUR_CLIENT_ID_HERE"
    SIDEFX_SECRET="YOUR_SECRET_HERE"
    HFS_VER="TARGET_HOUDINI_VERSION_HERE"

3. Download [Docker](https://docs.docker.com/get-docker/), a platform for developing and shipping applications.
4. Once you've download Docker and setup your account, run `docker compose build` to build the app's docker images.
   - If you encounter the following issue when building: `Error getting credentials`, you may need to run `docker login`.
5. `docker compose up` to start the Houdini Web Rendering App.
6. You can now access the Houdini Web Server at your local IP address.

## Download desired version of Houdini

Run the Houdini Install script located in the directory.
- This will download the corresponding production Python3.10 build of Houdini.
- If you're targeting <20.0, update the Dockerfile for Python3.9 support instead.
- Extract the .tar.gz file and create a build directory for the Dockerfile.

    python3 hou_install.py {HOUDINI_VERSION >=20.0}