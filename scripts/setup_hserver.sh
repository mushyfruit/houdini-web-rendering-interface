#!/bin/bash

# APIKey options also can be placed in `hserver.ini`, fka `hserver.opt`
echo "APIKey=www.sidefx.com $SIDEFX_CLIENT $SIDEFX_SECRET" > /root/houdini$HFS_TARGET/hserver.ini

# hserver will update the `.sesi_licenses.pref` file.
echo "Configuring license server..."
echo "serverhost=https://www.sidefx.com/license/sesinetd" > ~/.sesi_licenses.pref
hserver -S https://www.sidefx.com/license/sesinetd

# Restart
hserver -q
hserver
echo "Server started successfully."

cd /opt/houdini/build/
source ./houdini_setup
cd - > /dev/null 2>&1

echo "Houdini setup sourced successfully."

