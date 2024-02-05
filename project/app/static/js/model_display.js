const canvas = document.getElementById('renderCanvas');
const engine = new BABYLON.Engine(canvas, true);
const scene = new BABYLON.Scene(engine);

// Initialize camera and light
const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 15, new BABYLON.Vector3(0, 0, 0));
camera.attachControl(canvas, true);
const light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 0));

function onInit() {
    var canvas = document.getElementById('renderCanvas');
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', () => {
        engine.resize();
    });

    startRenderLoop();
    loadModel("placeholder.glb");
}

// Start and stop the render loop for performance.
function stopRenderLoop() {
    engine.stopRenderLoop();
}

function startRenderLoop() {
    engine.runRenderLoop(function () {
        scene.render();
    });
}

// Handle loading and clearing models.
function loadModel(fileName) {
    clearModels();
    BABYLON.SceneLoader.Append("/get_glb/", fileName, scene,
        function () {
            console.log("GLB Loaded Successfully!");
            scene.beginAnimation(scene, 0, 100, true);
        },

        function (evt) {
            console.log(evt);
        },

        function (scene, message, exception) {
            console.log("Error while loading GLB:", message);
            console.error(exception);
        }


    );
}

function clearModels() {
    scene.meshes.forEach(mesh => {
        if (mesh !== camera) {
            mesh.dispose();
        }
    });
}

onInit();