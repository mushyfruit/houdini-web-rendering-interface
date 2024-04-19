var canvas = document.getElementById('renderCanvas');

//Engine(canvasOrContext, antialias, options, adaptToDeviceRatio);
var engine = new BABYLON.Engine(canvas, true);

var scene = create_scene();

function create_scene() {
    var scene = new BABYLON.Scene(engine);

    const camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 15, new BABYLON.Vector3(0, 0, 0));
    camera.attachControl(canvas, true);

    // Adjust the scrolling zoom speed.
    camera.wheelPrecision = 50;
    camera.maxZ = 50000;

    const hemisphericLight = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(1, 1, 0));
    hemisphericLight.intensity = 0.6;

    const directionalLight = new BABYLON.DirectionalLight("dirLight", new BABYLON.Vector3(-1, -2, -1), scene);
    directionalLight.intensity = 0;

    const shadowGenerator = new BABYLON.ShadowGenerator(1024, directionalLight);
    shadowGenerator.useExponentialShadowMap = true;
    shadowGenerator.useKernelBlur = true;

    // Skybox
    var skybox = new BABYLON.Mesh.CreateBox("skyBox", 10000, scene);
    skybox.infiniteDistance = true;

    const skyboxes = [
        "overcast_sky.env",
        "photo_studio_small.env",
    ].map((url, index, arr) => {
        const skyboxTexture = new BABYLON.CubeTexture(`/get_skybox/${url}`, scene);
        const skybox = scene.createDefaultSkybox(skyboxTexture, true, 10000, 0.1);
        return { skybox, skyboxTexture }
    });

    function setCurrentSkybox(index) {
        for (var i = 0; i < skyboxes.length; i++) {
            const {skybox} = skyboxes[i];
            skybox.setEnabled(i === index);
        }
        const {skyboxTexture} = skyboxes[index];
        scene.environmentTexture = skyboxTexture;
    }

    setCurrentSkybox(0);

    scene.environmentTexture.level = .65;
    scene.environmentIntensity = 0.4;

    const highPassKernel = [
        0, -1/8, 0,
        -1/8, 1.25, -1/8,
        0, -1/8, 0,
    ];
    const highPass = new BABYLON.ConvolutionPostProcess("highPass", highPassKernel, 1.0, camera);

    // Set up Ambient Occlusion
    var ssaoRatio = {
        ssaoRatio: 0.5,
        blurRatio: 0.5
    };

    var ssao = new BABYLON.SSAO2RenderingPipeline("ssao", scene, ssaoRatio, null, false);
    ssao.radius = .5;
    ssao.totalStrength = 1.0;
    ssao.expensiveBlur = false;
    ssao.samples = 16;
    ssao.maxZ = 250;

    scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("ssao", camera);

    var isAttached = true;
    window.addEventListener("keydown", function (evt) {
        // draw SSAO with scene when pressed "1"
        if (evt.keyCode === 49) {
            if (!isAttached) {
                isAttached = true;
                scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("ssao", camera);
            }
            scene.postProcessRenderPipelineManager.enableEffectInPipeline("ssao", ssao.SSAOCombineRenderEffect, camera);
        }
            // draw without SSAO when pressed "2"
        else if (evt.keyCode === 50) {
            isAttached = false;
            scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline("ssao", camera);
        }
            // draw only SSAO when pressed "2"123
        else if (evt.keyCode === 51) {
            if (!isAttached) {
                isAttached = true;
                scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline("ssao", camera);
            }
            scene.postProcessRenderPipelineManager.disableEffectInPipeline("ssao", ssao.SSAOCombineRenderEffect, camera);
        }
    });

    return scene;
}


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

    BABYLON.SceneLoader.ImportMeshAsync(null, "/get_glb/", fileName, scene).then(result => {
        console.log("GLB Loaded Successfully!");
        result.meshes.forEach(mesh => {
            mesh.metadata = { imported: true }
            if (mesh.material && mesh.material instanceof BABYLON.PBRMaterial) {
                mesh.material.microSurface = 0.2;
            }

            // TODO Open panel to show current node's params? Fire off another render?
            mesh.actionManager = new BABYLON.ActionManager(scene);
            mesh.actionManager.registerAction(
              new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickTrigger, () =>
                  console.log("hi"),
              ),
            );

        });
    }).catch(error => {
        console.log("Error loading the GLB file:", error);
    });
}

function clearModels() {
    // Dispose of any meshes previously loaded.
    scene.meshes.forEach(mesh => {
        if (mesh.metadata && mesh.metadata.imported) {
            mesh.dispose();
        }
    });
}

onInit();
