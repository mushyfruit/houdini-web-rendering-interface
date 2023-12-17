# Houdini Web Rendering App
Started out as a simple exploration of the `hwebserver` module and quickly expanded beyond that.

Continuing to develop this in my spare time.

Attempts to create a user-friendly web interface combining `BabylonJS`, `CytoscapeJS`, and
the houdini python API. Allows for upload, examination, rendering, and display of nodes
within a .hip file all through a web interface.

# Setup Instruction

1. Set up login-based licensing and get your API key.
2. Run `pip install requirements_hou.txt` for the installation dependencies.
3. Run the `hou_install` script to download the tar.gz file for your version of Houdini.
4. Create a `.env` file with the following keys: (SIDEFX_CLIENT, SIDEFX_SECRET)
5. `docker compose build` to build the docker containers.
(Temporary local development workflow)
6. `docker compose up -d` to start docker containers in background.
7. `docker exec -it hou_container_local bash`
8. `source ../setup_hserver.sh`
9. `flask run --host 0.0.0.0 --port 8080`

## Getting the API Key

Using Login-based licensing:
https://www.sidefx.com/faq/question/how-do-i-setup-api-key-licensing/

Create a .env file and add the following:

    SIDEFX_CLIENT="YOUR_CLIENT_ID_HERE"
    SIDEFX_SECRET="YOUR_SECRET_HERE"
    HFS_VER="VERSION_HERE"

## Download desired version of Houdini

Run the Houdini Install script located in the directory.
- This will download the corresponding production Python3.10 build of Houdini.
- If you're targeting <20.0, update the Dockerfile for Python3.9 support instead.
- Extract the .tar.gz file and create a build directory for the Dockerfile.

    python3 hou_install.py {HOUDINI_VERSION >=20.0}

## Docker

    pip install -r requirements_hou.txt

## Pull the redis container
    
    docker pull redis