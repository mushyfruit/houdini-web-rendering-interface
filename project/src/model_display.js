import * as BABYLON from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials';
import { Pane } from 'tweakpane';
import { DISPLAY_UI_PARAMS, DEFAULT_SKYBOXES } from './constants';

// Must specify the loader as suffix here.
import '@babylonjs/loaders/glTF';

let canvas = document.getElementById('renderCanvas');
let globalSettings, skyboxes, camera, debugGrid;

//Engine(canvasOrContext, antialias, options, adaptToDeviceRatio);
let engine = new BABYLON.Engine(canvas, true);
let scene;

class DisplaySettings {
	constructor() {
		this.guiParams = { ...DISPLAY_UI_PARAMS };
		this.lastTexture = undefined;
		this.availableSkyboxes = [];

		//TODO Uncomment
		//this.loadParams();
	}

	saveParams() {
		localStorage.setItem('displaySettings', JSON.stringify(this.guiParams));
	}

	loadParams() {
		const savedSettings = JSON.parse(localStorage.getItem('displaySettings'));
		if (savedSettings) {
			this.guiParams = savedSettings;
		}
	}
}

function create_scene() {
	globalSettings = new DisplaySettings();
	scene = new BABYLON.Scene(engine);

	camera = new BABYLON.ArcRotateCamera(
		'camera',
		-Math.PI / 2,
		Math.PI / 2.5,
		15,
		new BABYLON.Vector3(0, 0, 0),
	);
	camera.attachControl(canvas, true);

	// Adjust the scrolling zoom speed.
	camera.wheelPrecision = 50;
	camera.maxZ = 50000;

	const hemisphericLight = new BABYLON.HemisphericLight('light', new BABYLON.Vector3(1, 1, 0));
	hemisphericLight.intensity = 0.6;

	const directionalLight = new BABYLON.DirectionalLight(
		'dirLight',
		new BABYLON.Vector3(-1, -2, -1),
		scene,
	);
	directionalLight.intensity = 0;

	const shadowGenerator = new BABYLON.ShadowGenerator(1024, directionalLight);
	shadowGenerator.useExponentialShadowMap = true;
	shadowGenerator.useKernelBlur = true;

	// Skybox
	var skybox = new BABYLON.MeshBuilder.CreateBox('skyBox', { size: 10000 }, scene);
	skybox.infiniteDistance = true;

	// Generate .env from .hdr file: https://www.babylonjs.com/tools/ibl/
	// Custom packing IBL environment into single, optimized file.
	const skyboxValues = Object.values(DEFAULT_SKYBOXES);
	skyboxes = skyboxValues.map((url, index, arr) => {
		const skyboxTexture = new BABYLON.CubeTexture(`/get_skybox/${url}`, scene);
		const skybox = scene.createDefaultSkybox(skyboxTexture, true, 10000, 0.1);
		return { skybox, skyboxTexture };
	});
	setCurrentSkybox(0);

	scene.environmentTexture.level = 0.65;
	scene.environmentIntensity = 0.4;

	const highPassKernel = [0, -1 / 8, 0, -1 / 8, 1.25, -1 / 8, 0, -1 / 8, 0];
	const highPass = new BABYLON.ConvolutionPostProcess('highPass', highPassKernel, 1.0, camera);

	// Set up Ambient Occlusion
	var ssaoRatio = {
		ssaoRatio: 0.5,
		blurRatio: 0.5,
	};

	var ssao = new BABYLON.SSAO2RenderingPipeline('ssao', scene, ssaoRatio, null, false);
	ssao.radius = 0.5;
	ssao.totalStrength = 1.0;
	ssao.expensiveBlur = false;
	ssao.samples = 16;
	ssao.maxZ = 250;

	scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', camera);

	var isAttached = true;
	window.addEventListener('keydown', function (evt) {
		// draw SSAO with scene when pressed "1"
		if (evt.keyCode === 49) {
			if (!isAttached) {
				isAttached = true;
				scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(
					'ssao',
					camera,
				);
			}
			scene.postProcessRenderPipelineManager.enableEffectInPipeline(
				'ssao',
				ssao.SSAOCombineRenderEffect,
				camera,
			);
		}
		// draw without SSAO when pressed "2"
		else if (evt.keyCode === 50) {
			isAttached = false;
			scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline('ssao', camera);
		}
		// draw only SSAO when pressed "2"123
		else if (evt.keyCode === 51) {
			if (!isAttached) {
				isAttached = true;
				scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(
					'ssao',
					camera,
				);
			}
			scene.postProcessRenderPipelineManager.disableEffectInPipeline(
				'ssao',
				ssao.SSAOCombineRenderEffect,
				camera,
			);
		}
	});

	return scene;
}

function setCurrentSkybox(index) {
	if (globalSettings.guiParams.displayBindings.background) {
		for (let i = 0; i < skyboxes.length; i++) {
			const { skybox } = skyboxes[i];
			skybox.setEnabled(i === index);
		}
		const { skyboxTexture } = skyboxes[index];
		scene.environmentTexture = skyboxTexture;
	} else {
		globalSettings.lastTexture = index;
	}
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

	prepareModelDisplay();
	loadModel('placeholder.glb', [1, 240]);
}

export function prepareModelDisplay() {
	// Restart the engine if necessary.
	if (engine.activeRenderLoops.length == 0) {
		startRenderLoop();
	}

	// Check if we've initialized the display settings panel.
	// If so, just ensure that the panel is unhidden.
	const panel = document.getElementById('tp-container');
	if (panel.hasChildNodes()) {
		panel.style.display = 'block';
	} else {
		generateSettingsPanel();
	}
}

function generateSettingsPanel() {
	if (!globalSettings) {
		globalSettings = new DisplaySettings();
	} else {
		//TODO Uncomment
		//globalSettings.loadParams();
	}

	// Add the parent pane and handle storing settings on fold.
	const pane = new Pane({
		container: document.getElementById('tp-container'),
		title: 'Houdini Web Viewer',
		expanded: globalSettings.guiParams.ui.pane.expanded,
	});
	pane.on('fold', (ev) => {
		globalSettings.guiParams.ui.pane.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	// Add the display folder and handle fold callback events.
	const displayFolder = pane.addFolder({
		title: 'Display',
		expanded: globalSettings.guiParams.ui.display.expanded,
	});
	displayFolder.on('fold', (ev) => {
		globalSettings.guiParams.ui.display.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	const display_bindings = [
		{ key: 'background', callbackFunc: toggleBackground, pass_value: false },
		{ key: 'wireframe', callbackFunc: toggleWireframe, pass_value: true },
		{ key: 'grid', callbackFunc: toggleGrid, pass_value: false },
		{
			key: 'grid_size',
			callbackFunc: updateGridSize,
			options: { min: 0, max: 1000 },
			pass_value: true,
		},
		{ key: 'autorotate', callbackFunc: toggleAutoRotate, pass_value: false },
		{
			key: 'autorotate_speed',
			callbackFunc: adjustAutoRotateSpeed,
			options: { min: 0, max: 3, step: 0.05 },
			pass_value: true,
		},
		{ key: 'background_color', callbackFunc: updateBackgroundColor, pass_value: true },
	];

	display_bindings.forEach((binding) => {
		setupDefaultBinding(
			globalSettings.guiParams.displayBindings,
			displayFolder,
			binding.key,
			binding.callbackFunc,
			binding.options || {},
			binding.pass_value,
		);
	});

	const lighting_bindings = [];

	const lightingFolder = pane.addFolder({
		title: 'Lighting',
		expanded: globalSettings.guiParams.ui.lighting.expanded,
	});
	displayFolder.on('fold', (ev) => {
		globalSettings.guiParams.ui.lighting.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	const skyboxOptions = Object.keys(DEFAULT_SKYBOXES).map((key) => ({
		text: key,
		value: DEFAULT_SKYBOXES[key],
	}));

	lightingFolder
		.addBlade({
			view: 'list',
			label: 'environment',
			options: skyboxOptions,
			value: globalSettings.guiParams.lightingBindings.environment,
		})
		.on('change', (ev) => {
			if (!ev.last) return;
			setBackgroundTexture(ev.value);
			globalSettings.guiParams.lightingBindings.environment = ev.value;
			globalSettings.saveParams();
		});

	lighting_bindings.forEach((binding) => {
		setupDefaultBinding(
			globalSettings.guiParams.lightingBindings,
			lightingFolder,
			binding.key,
			binding.callbackFunc,
			binding.options || {},
			binding.pass_value,
		);
	});
}

function setBackgroundTexture(value) {
	const skyboxValues = Object.values(DEFAULT_SKYBOXES);
	const selectedIndex = skyboxValues.indexOf(value);
	if (selectedIndex === -1) {
		// Something went wrong, just fallback.
		setCurrentSkybox(0);
		console.error(`Unable to find environment: ${value}`);
	} else {
		setCurrentSkybox(selectedIndex);
	}
}

function setupDefaultBinding(settings, folder, key, callbackFunc, options, pass_value = false) {
	folder.addBinding(settings, key, options).on('change', (ev) => {
		if (!ev.last) return;
		if (pass_value) {
			callbackFunc(ev.value);
		} else {
			callbackFunc();
		}
		settings[key] = ev.value;
		globalSettings.saveParams();
	});
}

function rgbStringToColor3(rgbString) {
	// Extract the RGB values from the string using a regular expression
	const result = rgbString.match(/\d+/g).map(Number);
	const [r, g, b] = result;
	return new BABYLON.Color3(r / 255, g / 255, b / 255);
}

function updateBackgroundColor(value) {
	scene.clearColor = rgbStringToColor3(value);
}

function toggleGrid() {
	if (!debugGrid) {
		debugGrid = createGrid();
	}

	const gridEnabled = debugGrid.grid.isEnabled();
	if (!gridEnabled) {
		updateGridSize(globalSettings.guiParams.displayBindings.grid_size);
	}
	debugGrid.axes.forEach((axis) => {
		axis.setEnabled(!gridEnabled);
	});
	debugGrid.grid.setEnabled(!gridEnabled);
}

function updateGridSize(value) {
	if (debugGrid.grid.isEnabled()) {
		// Get the vertex positions
		let positions = debugGrid.grid.getVerticesData(BABYLON.VertexBuffer.PositionKind);
		positions[0] = -value / 2;
		positions[1] = 0;
		positions[2] = value / 2;

		positions[3] = value / 2;
		positions[4] = 0;
		positions[5] = value / 2;

		positions[6] = -value / 2;
		positions[7] = 0;
		positions[8] = -value / 2;

		positions[9] = value / 2;
		positions[10] = 0;
		positions[11] = -value / 2;

		debugGrid.grid.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
		debugGrid.grid.refreshBoundingInfo();
	}
	globalSettings.guiParams.displayBindings.grid_size = value;
	globalSettings.saveParams();
}

function createGrid(grid_size = 8) {
	const grid = BABYLON.MeshBuilder.CreateGround(
		'ground',
		{ width: grid_size, height: grid_size, updatable: true },
		scene,
	);

	const gridTexture = new GridMaterial('grid', scene);

	gridTexture.backFaceCulling = false;
	gridTexture.mainColor = BABYLON.Color3.Black();
	gridTexture.lineColor = BABYLON.Color3.Black();
	gridTexture.opacity = 0.5;

	grid.material = gridTexture;
	grid.alwaysSelectAsActiveMesh = true;
	grid.isPickable = false;
	grid.setEnabled(false);

	const axes = createAxes(grid_size);

	return { axes: axes, grid: grid };
}

function createAxes(grid_size) {
	const axes = {
		x: { direction: BABYLON.Vector3.Right(), color: BABYLON.Color3.Red() },
		y: { direction: BABYLON.Vector3.Up(), color: BABYLON.Color3.Green() },
		z: { direction: BABYLON.Vector3.Backward(), color: BABYLON.Color3.Blue() },
	};

	const lines = [];
	const unitLength = grid_size / 2;

	for (const axis in axes) {
		const { direction, color: axis_color } = axes[axis];
		const p1 = new BABYLON.Vector3(unitLength, unitLength, unitLength).multiplyInPlace(
			direction,
		);
		const p2 = p1.scale(-1);

		const line = BABYLON.MeshBuilder.CreateLines(
			`${axis}`,
			{
				points: [p1, p2],
				colors: [axis_color, axis_color],
				useVertexAlpha: false,
				updatable: false,
			},
			scene,
		);
		line.isPickable = false;
		line.setEnabled(false);
		lines.push(line);
	}

	return lines;
}

function toggleAutoRotate() {
	camera.useAutoRotationBehavior = !camera.useAutoRotationBehavior;
	if (camera.useAutoRotationBehavior) {
		camera.autoRotationBehavior.idleRotationSpeed =
			globalSettings.guiParams.displayBindings.autorotate_speed;
	}
}

function adjustAutoRotateSpeed(value) {
	if (camera.autoRotationBehavior) {
		camera.autoRotationBehavior.idleRotationSpeed = value;
	}
}

function toggleBackground() {
	if (scene.environmentTexture) {
		let skyboxIndex = -1;
		for (var i = 0; i < skyboxes.length; i++) {
			const { skybox } = skyboxes[i];
			if (skybox.isEnabled()) {
				skyboxIndex = i;
			}
			skybox.setEnabled(false);
		}
		globalSettings.lastTexture = skyboxIndex;
		scene.environmentTexture = undefined;
	} else {
		const { skybox } = skyboxes[globalSettings.lastTexture];
		const { skyboxTexture } = skyboxes[globalSettings.lastTexture];
		skybox.setEnabled(true);
		scene.environmentTexture = skyboxTexture;
	}
}

function toggleWireframe(value) {
	scene.meshes.forEach((mesh) => {
		if (mesh.metadata && mesh.metadata.imported) {
			if (mesh.material) {
				if (!value) {
					if (mesh.material.originalEmissiveColor) {
						mesh.material.emissiveColor = mesh.material.originalEmissiveColor;
					}
				} else {
					if (mesh.material.emissiveColor) {
						mesh.material.originalEmissiveColor = mesh.material.emissiveColor.clone();
					}
					mesh.material.emissiveColor = BABYLON.Color3.White();
				}
				mesh.material.wireframe = value;
			}
		}
	});
}

export function hideSettingsPanel() {
	const panel = document.getElementById('tp-container');
	if (panel) {
		panel.style.display = 'none';
	}
}

// Start and stop the render loop for performance.
export function stopRenderLoop() {
	engine.stopRenderLoop();
}

export function startRenderLoop() {
	engine.runRenderLoop(function () {
		scene.render();
	});
}

// Handle loading and clearing models.
export function loadModel(fileName, frameRange) {
	clearModels();

	BABYLON.SceneLoader.ImportMeshAsync(null, '/get_glb/', fileName, scene)
		.then((result) => {
			console.log('GLB Loaded Successfully!');
			result.meshes.forEach((mesh) => {
				mesh.metadata = { imported: true };
				if (mesh.material && mesh.material instanceof BABYLON.PBRMaterial) {
					mesh.material.microSurface = 0.2;
				}

				// TODO Open panel to show current node's params? Fire off another render?
				mesh.actionManager = new BABYLON.ActionManager(scene);
				mesh.actionManager.registerAction(
					new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickTrigger, () =>
						console.log('Clicked the model...'),
					),
				);
			});

			toggleWireframe(globalSettings.guiParams.displayBindings.wireframe);
			scene.beginAnimation(scene, frameRange[0], frameRange[1], true);
		})
		.catch((error) => {
			console.log('Error loading the GLB file:', error);
		});
}

function clearModels() {
	// Dispose of any meshes previously loaded.
	scene.meshes.forEach((mesh) => {
		if (mesh.metadata && mesh.metadata.imported) {
			mesh.dispose();
		}
	});
}

create_scene();
onInit();
