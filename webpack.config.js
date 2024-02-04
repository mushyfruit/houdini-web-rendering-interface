const webpack = require('webpack');

const config = {
    entry: {
        sidebar: __dirname + '/project/app/src/sidebar.js',
        modelDisplay: __dirname + '/project/app/src/model_display.js',
        nodeGraph: __dirname + '/project/app/src/node_graph.js',
    },
    output: {
        path: __dirname + '/project/app/static/js',
        filename: '[name].bundle.js',
    },
    resolve: {
        extensions: ['.js', '.css']
    },
};
module.exports = config;