var canvas = document.getElementById('renderCanvas');
var engine = new BABYLON.Engine(canvas, true);
var scene = new BABYLON.Scene(engine);

// Initialize camera and light
const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 15, new BABYLON.Vector3(0, 0, 0));
camera.attachControl(canvas, true);
camera.maxZ = 50000;

const hemisphericLight = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 0));
hemisphericLight.intensity = 0.6;

const directionalLight = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(-1, -2, -1), scene);
directionalLight.intensity = 1.2;

const shadowGenerator = new BABYLON.ShadowGenerator(1024, directionalLight);
shadowGenerator.useExponentialShadowMap = true;

var created_meshes = [];

function onInit() {
    var canvas = document.getElementById('renderCanvas');
    if (canvas) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', () => {
        engine.resize();
    });

    var skybox = new BABYLON.Mesh.CreateBox("skyBox", 1000, scene);
    skybox.infiniteDistance = true;
    //console.log(skybox);

    var skyboxMaterial = new BABYLON.StandardMaterial("skyBox", scene);
    skyboxMaterial.backFaceCulling = false;
    //skyboxMaterial.disableLighting = true;

    var files = [
        "/get_skybox/skybox_nx.jpg",
        "/get_skybox/skybox_py.jpg",
        "/get_skybox/skybox_nz.jpg",
        "/get_skybox/skybox_px.jpg",
        "/get_skybox/skybox_ny.jpg",
        "/get_skybox/skybox_pz.jpg",
    ];

    skyboxMaterial.diffuseColor = new BABYLON.Color3(0, 0, 0);
    skyboxMaterial.specularColor = new BABYLON.Color3(0, 0, 0);

    skyboxMaterial.reflectionTexture = new BABYLON.CubeTexture.CreateFromImages(files, scene);
    skyboxMaterial.reflectionTexture.coordinatesMode = BABYLON.Texture.SKYBOX_MODE;

    skybox.material = skyboxMaterial;

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

    BABYLON.SceneLoader.ImportMeshAsync(null, "/get_glb/", fileName, scene).then(result => {
        console.log("GLB Loaded Successfully!");
        result.meshes.forEach(mesh => {
            created_meshes.push(mesh);
            shadowGenerator.addShadowCaster(mesh);
        });
    }).catch(error => {
        console.log("Error loading the GLB file:", error);
    });
}

function clearModels() {
    created_meshes.forEach(mesh => {
        if (mesh !== camera) {
            mesh.dispose();
        }
    });
}

onInit();