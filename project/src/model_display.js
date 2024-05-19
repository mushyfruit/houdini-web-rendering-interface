import * as BABYLON from '@babylonjs/core';
import { GridMaterial } from '@babylonjs/materials';
import { Pane } from 'tweakpane';
import { DISPLAY_UI_PARAMS, DEFAULT_SKYBOXES, DEFAULT_CAMERA_OPTION } from './constants';

// Must specify the loader as suffix here.
import '@babylonjs/loaders/glTF';

let sceneManager, globalSettings;

class SceneManager {
	constructor() {
		this.canvas = document.getElementById('renderCanvas');

		//Engine(canvasOrContext, antialias, options, adaptToDeviceRatio);
		this.engine = new BABYLON.Engine(this.canvas, true);
		this.scene = null;
		this.skyboxes = [];
		this.skyboxMeshes = {};
		this.skyboxValues = [];

		this.lightingBlade = null;
		this.currentSceneLights = null;

		this.pane = null;
		this.cameraFolder = null;
		this.cameraBlade = null;

		this.animationFolder = null;

		this.debugGrid = null;
		this.axes = null;

		this._initialize();
	}

	_initialize() {
		this._createScene();
		this._createSettingsPane();
		this._createDefaultCamera();
		this._createSkyboxTextures();
	}

	_createScene() {
		this.scene = new BABYLON.Scene(this.engine);
	}

	_createSettingsPane() {
		this.pane = new Pane({
			container: document.getElementById('tp-container'),
			title: 'Houdini Web Viewer',
			expanded: globalSettings.guiParams.ui.pane.expanded,
		});
	}

	_createDefaultCamera() {
		this.camera = new BABYLON.ArcRotateCamera(
			'defaultCamera',
			-Math.PI / 2,
			Math.PI / 2.5,
			15,
			new BABYLON.Vector3(0, 0, 0),
		);
		this.camera.attachControl(this.canvas, true);

		// Adjust the scrolling zoom speed.
		this.camera.wheelPrecision = 50;
		this.camera.maxZ = 50000;
	}

	_createSkyboxTextures() {
		// Generate .env from .hdr file: https://www.babylonjs.com/tools/ibl/
		// Custom packing IBL environment into single, optimized file.
		this.skyboxValues = Object.values(DEFAULT_SKYBOXES);
		this.skyboxes = this.skyboxValues.map((url, index, arr) => {
			return new BABYLON.CubeTexture(`/get_skybox/${url}`, this.scene);
		});
	}

	clearSceneLights() {
		this.currentSceneLights = [];
	}

	createDebugGrid(grid_size = 8) {
		const grid = BABYLON.MeshBuilder.CreateGround(
			'ground',
			{ width: grid_size, height: grid_size, updatable: true },
			this.scene,
		);

		const gridTexture = new GridMaterial('grid', this.scene);

		gridTexture.backFaceCulling = false;
		gridTexture.mainColor = BABYLON.Color3.Black();
		gridTexture.lineColor = BABYLON.Color3.Black();
		gridTexture.opacity = 0.5;

		grid.material = gridTexture;
		grid.alwaysSelectAsActiveMesh = true;
		grid.isPickable = false;
		grid.setEnabled(false);

		this.debugGrid = grid;

		// Default to locking axes at 8 for now.
		this.axes = this.createAxes(8);
	}

	createAxes(grid_size) {
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
				this.scene,
			);
			line.isPickable = false;
			line.setEnabled(false);
			lines.push(line);
		}

		return lines;
	}

	toggleLightBlade(value) {
		if (this.lightingBlade) {
			this.lightingBlade.hidden = !value;
		}
	}

	toggleAnimationFolder(value) {
		if (this.animationFolder) {
			this.animationFolder.hidden = !value;
		}
	}

	toggleCameraFolder(value) {
		if (this.cameraFolder) {
			this.cameraFolder.hidden = !value;
		}
	}

	updateCameraOptions() {
		if (!this.cameraBlade) {
			return;
		}

		let newOptions = [DEFAULT_CAMERA_OPTION];
		for (let i = 1; i < this.scene.cameras.length; i++) {
			const houdiniCamera = this.scene.cameras[i].name;
			newOptions.push({ text: houdiniCamera, value: houdiniCamera });
		}
		this.cameraBlade.options = newOptions;
		this.cameraBlade.value = DEFAULT_CAMERA_OPTION.value;
		this.pane.refresh();
	}
}

class DisplaySettings {
	constructor() {
		this.guiParams = { ...DISPLAY_UI_PARAMS };
		this.lastTexture = undefined;
		this.loadParams();
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
	const scene = sceneManager.scene;
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

	// Set the default background texture.
	setBackgroundTexture(sceneManager.skyboxValues[0]);

	scene.environmentTexture.level = 0.65;
	scene.environmentIntensity = 0.4;

	const highPassKernel = [0, -1 / 8, 0, -1 / 8, 1.25, -1 / 8, 0, -1 / 8, 0];
	const highPass = new BABYLON.ConvolutionPostProcess(
		'highPass',
		highPassKernel,
		1.0,
		sceneManager.camera,
	);

	// Set up Ambient Occlusion
	let ssaoRatio = {
		ssaoRatio: 0.5,
		blurRatio: 0.5,
	};

	let ssao = new BABYLON.SSAO2RenderingPipeline('ssao', scene, ssaoRatio, null, false);
	ssao.radius = 0.5;
	ssao.totalStrength = 1.0;
	ssao.expensiveBlur = false;
	ssao.samples = 16;
	ssao.maxZ = 250;

	// Need to attach relevant cameras or else it'll freeze the render.
	//scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline('ssao', sceneManager.camera);

	if (globalSettings.guiParams.lightingBindings.rotate_environment) {
		toggleEnvironmentRotation(true);
	}

	if (globalSettings.guiParams.displayBindings.autorotate) {
		toggleAutoRotate();
	}

	return scene;
}

function setCurrentSkybox(index) {
	if (globalSettings.guiParams.displayBindings.background) {
		if (sceneManager.skyboxMeshes[index] === undefined) {
			sceneManager.skyboxMeshes[index] = sceneManager.scene.createDefaultSkybox(
				sceneManager.skyboxes[index],
				true,
				10000,
				globalSettings.guiParams.lightingBindings.environment_blur,
			);
			sceneManager.scene.environmentTexture = sceneManager.skyboxes[index];
		}

		// Disable all other skyboxes.
		Object.keys(sceneManager.skyboxMeshes).forEach((meshIndex) => {
			sceneManager.skyboxMeshes[meshIndex].setEnabled(parseInt(meshIndex) === index);
		});

		sceneManager.scene.environmentTexture = sceneManager.skyboxes[index];
	} else {
		globalSettings.lastTexture = index;
	}
}

function onInit() {
	if (sceneManager.canvas) {
		sceneManager.canvas.width = window.innerWidth;
		sceneManager.canvas.height = window.innerHeight;
	}
	window.addEventListener('resize', () => {
		sceneManager.engine.resize();
	});

	prepareModelDisplay();
	loadModel('placeholder.glb', [1, 240]);
}

export function prepareModelDisplay() {
	// Restart the engine if necessary.
	if (sceneManager.engine.activeRenderLoops.length === 0) {
		startRenderLoop();
	}

	// Check if we've initialized the display settings panel.
	// If so, just ensure that the panel is unhidden.
	const panel = document.getElementById('tp-container');
	if (sceneManager.pane.children.length > 0) {
		panel.style.display = 'block';
	} else {
		generateSettingsPanel();
	}
}

function generateSettingsPanel() {
	globalSettings.loadParams();

	// Add the parent pane and handle storing settings on fold.
	sceneManager.pane.on('fold', (ev) => {
		globalSettings.guiParams.ui.pane.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	// Add the display folder and handle fold callback events.
	const displayFolder = sceneManager.pane.addFolder({
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
			options: { min: 0, max: 1000, step: 10 },
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

	const lighting_bindings = [
		{
			key: 'environment_exposure',
			callbackFunc: adjustExposure,
			options: { min: 0, max: 5, step: 0.05 },
			pass_value: true,
		},
		{
			key: 'environment_blur',
			callbackFunc: adjustEnvironmentBlur,
			options: { min: 0, max: 1, step: 0.01 },
			pass_value: true,
		},
		{
			key: 'environment_rotation',
			callbackFunc: adjustEnvironmentRotation,
			options: { min: 0, max: 360, step: 1 },
			pass_value: true,
		},
		{ key: 'rotate_environment', callbackFunc: toggleEnvironmentRotation, pass_value: true },
		{
			key: 'rotate_speed',
			callbackFunc: () => {},
			options: { min: 0, max: 100, step: 1 },
			pass_value: true,
		},
		{ key: 'disable_houdini_lighting', callbackFunc: toggleHoudiniLights, pass_value: true },
	];

	console.log(globalSettings.guiParams.ui.lighting.expanded);
	const lightingFolder = sceneManager.pane.addFolder({
		title: 'Lighting',
		expanded: globalSettings.guiParams.ui.lighting.expanded,
	});
	lightingFolder.on('fold', (ev) => {
		globalSettings.guiParams.ui.lighting.expanded = ev.expanded;
		console.log(ev.expanded);
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

	lightingFolder.children.forEach((child) => {
		if (child.key === 'disable_houdini_lighting') {
			sceneManager.lightingBlade = child;
		}
	});

	const cameraFolder = sceneManager.pane.addFolder({
		title: 'Camera',
		expanded: globalSettings.guiParams.ui.camera.expanded,
	});
	cameraFolder.on('fold', (ev) => {
		globalSettings.guiParams.ui.camera.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	// Hide this by default, if .glb with camera is found, unhide.
	cameraFolder.hidden = true;
	sceneManager.cameraFolder = cameraFolder;
	sceneManager.cameraBlade = cameraFolder
		.addBlade({
			view: 'list',
			label: 'camera',
			options: [DEFAULT_CAMERA_OPTION],
			value: globalSettings.guiParams.cameraBindings.camera,
		})
		.on('change', (ev) => {
			if (!ev.last) return;
			setSceneCamera(ev.value);
			globalSettings.guiParams.lightingBindings.environment = ev.value;
			globalSettings.saveParams();
		});

	const animationFolder = sceneManager.pane.addFolder({
		title: 'Animation',
		expanded: globalSettings.guiParams.ui.animation.expanded,
	});
	animationFolder.on('fold', (ev) => {
		globalSettings.guiParams.ui.animation.expanded = ev.expanded;
		globalSettings.saveParams();
	});

	// Hide by default, dynamically populating if animations are found.
	animationFolder.hidden = true;
	sceneManager.animationFolder = animationFolder;
}

function populateAnimationFolder(animations) {
	if (!sceneManager.animationFolder) {
		return;
	}

	// Clear the previously saved blades.
	sceneManager.animationFolder.children.forEach((child) => {
		child.dispose();
	});

	animations.forEach((animation, index) => {
		const animationName = `${index + 1}. ${animation.name}`;
		const defaultEnabled = index === 0;
		const param = { animationName: defaultEnabled };

		const binding = sceneManager.animationFolder
			.addBinding(param, 'animationName')
			.on('change', (ev) => {
				if (!ev.last) return;
				displayAnimation(ev.target, ev.value);
			});
		binding.label = animationName;
		binding.originalAnimation = animation;
	});
}

function displayAnimation(target, value) {
	if (target.originalAnimation) {
		if (value) {
			target.originalAnimation.start(true);
		} else {
			// Reset the animation to beginning and stop it.
			target.originalAnimation.goToFrame(1);
			target.originalAnimation.stop();
		}
	}
}

function toggleHoudiniLights(value) {
	if (sceneManager.currentSceneLights) {
		sceneManager.currentSceneLights.forEach((light) => {
			light.setEnabled(!value);
		});
	}
}

function setBackgroundTexture(value) {
	const skyboxValues = Object.values(DEFAULT_SKYBOXES);
	const selectedIndex = skyboxValues.indexOf(value);

	if (selectedIndex === -1) {
		// Something went wrong, just fallback.
		setCurrentSkybox(0);
		globalSettings.lastTexture = 0;
		console.error(`Unable to find environment: ${value}`);
	} else {
		globalSettings.lastTexture = selectedIndex;
		setCurrentSkybox(selectedIndex);
	}
	globalSettings.saveParams();
}

function setSceneCamera(value) {
	const newCamera = sceneManager.scene.getCameraByName(value);
	if (newCamera) {
		sceneManager.scene.activeCamera.detachControl();
		sceneManager.scene.activeCamera = newCamera;
		sceneManager.scene.activeCamera.attachControl(sceneManager.canvas, true);
	}
}

function setupDefaultBinding(settings, folder, key, callbackFunc, options, pass_value = false) {
	const binding = folder.addBinding(settings, key, options).on('change', (ev) => {
		if (!ev.last) return;
		if (pass_value) {
			callbackFunc(ev.value);
		} else {
			callbackFunc();
		}
		settings[key] = ev.value;
		globalSettings.saveParams();
	});

	// Remove any underscores to make the labels a bit nicer.
	if (key.includes('_')) {
		binding.label = key.replace(/_/g, ' ');
	}
}

function rgbStringToColor3(rgbString) {
	// Extract the RGB values from the string using a regular expression
	const result = rgbString.match(/\d+/g).map(Number);
	const [r, g, b] = result;
	return new BABYLON.Color3(r / 255, g / 255, b / 255);
}

function updateBackgroundColor(value) {
	sceneManager.scene.clearColor = rgbStringToColor3(value);
}

function adjustExposure(value) {
	sceneManager.scene.environmentIntensity = value;
}

function adjustEnvironmentBlur(value) {
	const currentMesh = sceneManager.skyboxMeshes[globalSettings.lastTexture];
	currentMesh.material.microSurface = 1 - value;
}

function adjustEnvironmentRotation(value) {
	const currentMesh = sceneManager.skyboxMeshes[globalSettings.lastTexture];
	const rotMatrix = BABYLON.Matrix.RotationY(BABYLON.Tools.ToRadians(value));
	sceneManager.scene.environmentTexture.setReflectionTextureMatrix(rotMatrix);
	currentMesh.material.reflectionTexture.setReflectionTextureMatrix(rotMatrix);
}

function toggleEnvironmentRotation(value) {
	if (value) {
		if (sceneManager.scene.environmentTexture) {
			sceneManager.scene.registerBeforeRender(rotateTexture);
		}
	} else {
		sceneManager.scene.unregisterBeforeRender(rotateTexture);
	}
}

function mapRange(value, inMin, inMax, outMin, outMax) {
	return ((value - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

function rotateTexture() {
	if (!sceneManager.scene.environmentTexture) {
		return;
	}
	const currentMesh = sceneManager.skyboxMeshes[globalSettings.lastTexture];
	const matrix = currentMesh.material.reflectionTexture.getReflectionTextureMatrix();
	const theta = Math.atan2(matrix.m[8], matrix.m[10]);
	const angle = BABYLON.Tools.ToDegrees(theta);

	const perFrame = mapRange(globalSettings.guiParams.lightingBindings.rotate_speed, 0, 100, 0, 2);
	const rotMatrix = BABYLON.Matrix.RotationY(BABYLON.Tools.ToRadians(angle + perFrame));
	sceneManager.scene.environmentTexture.setReflectionTextureMatrix(rotMatrix);
	currentMesh.material.reflectionTexture.setReflectionTextureMatrix(rotMatrix);
}

function toggleGrid() {
	if (!sceneManager.debugGrid) {
		sceneManager.createDebugGrid(globalSettings.guiParams.displayBindings.grid_size);
	}

	const gridEnabled = sceneManager.debugGrid.isEnabled();
	if (!gridEnabled) {
		updateGridSize(globalSettings.guiParams.displayBindings.grid_size);
	}
	sceneManager.axes.forEach((axis) => {
		axis.setEnabled(!gridEnabled);
	});
	sceneManager.debugGrid.setEnabled(!gridEnabled);
}

function updateGridSize(value) {
	if (sceneManager.debugGrid && sceneManager.debugGrid.isEnabled()) {
		// Get the vertex positions
		let positions = sceneManager.debugGrid.getVerticesData(BABYLON.VertexBuffer.PositionKind);
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

		sceneManager.debugGrid.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
		sceneManager.debugGrid.refreshBoundingInfo();
	}
	globalSettings.guiParams.displayBindings.grid_size = value;
	globalSettings.saveParams();
}

function toggleAutoRotate() {
	const camera = sceneManager.scene.activeCamera;
	camera.useAutoRotationBehavior = !camera.useAutoRotationBehavior;
	if (camera.useAutoRotationBehavior) {
		camera.autoRotationBehavior.idleRotationSpeed =
			globalSettings.guiParams.displayBindings.autorotate_speed;
	}
}

function adjustAutoRotateSpeed(value) {
	const camera = sceneManager.scene.activeCamera;
	if (camera.autoRotationBehavior) {
		camera.autoRotationBehavior.idleRotationSpeed = value;
	}
}

function toggleBackground() {
	if (sceneManager.scene.environmentTexture) {
		const mesh = sceneManager.skyboxMeshes[globalSettings.lastTexture];
		mesh.setEnabled(false);
		sceneManager.scene.environmentTexture = undefined;
	} else {
		setCurrentSkybox(globalSettings.lastTexture);
		sceneManager.scene.environmentTexture = sceneManager.skyboxes[globalSettings.lastTexture];
	}
}

function toggleWireframe(value) {
	sceneManager.scene.meshes.forEach((mesh) => {
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
	sceneManager.engine.stopRenderLoop();
}

export function startRenderLoop() {
	sceneManager.engine.runRenderLoop(function () {
		sceneManager.scene.render();
	});
}

// Handle loading and clearing models.
export function loadModel(fileName, frameRange) {
	clearModels();
	BABYLON.SceneLoader.ImportMeshAsync(null, '/get_glb/', fileName, sceneManager.scene)
		.then((result) => {
			console.log('GLB Loaded Successfully!');

			// Scene always contains default camera named "defaultCamera".
			const hasCameras = sceneManager.scene.cameras.length > 1;
			sceneManager.toggleCameraFolder(hasCameras);
			if (hasCameras) {
				sceneManager.updateCameraOptions();
			}

			// Toggle "disable_houdini_lighting" blade if no lights.

			const hasLights = result.lights.length > 0;
			sceneManager.toggleLightBlade(hasLights);
			if (hasLights) {
				sceneManager.currentSceneLights = result.lights;
			} else {
				sceneManager.clearSceneLights();
			}

			// Toggle the Animation folder if no animations, otherwise populate.
			const hasAnimation = result.animationGroups.length > 0;
			sceneManager.toggleAnimationFolder(hasAnimation);
			if (hasAnimation) {
				populateAnimationFolder(result.animationGroups);
			}

			result.meshes.forEach((mesh) => {
				mesh.metadata = { imported: true };
				if (mesh.material && mesh.material instanceof BABYLON.PBRMaterial) {
					mesh.material.microSurface = 0.3;
				}

				// TODO Open panel to show current node's params? Fire off another render?
				mesh.actionManager = new BABYLON.ActionManager(sceneManager.scene);
				mesh.actionManager.registerAction(
					new BABYLON.ExecuteCodeAction(BABYLON.ActionManager.OnPickTrigger, () =>
						console.log('Clicked the model...'),
					),
				);
			});

			toggleWireframe(globalSettings.guiParams.displayBindings.wireframe);
			sceneManager.scene.beginAnimation(
				sceneManager.scene,
				frameRange[0],
				frameRange[1],
				true,
			);
		})
		.catch((error) => {
			console.log('Error loading the GLB file:', error);
		});
}

function clearModels() {
	// Dispose of any meshes previously loaded.
	sceneManager.scene.meshes.forEach((mesh) => {
		if (mesh.metadata && mesh.metadata.imported) {
			mesh.dispose();
		}
	});
}

globalSettings = new DisplaySettings();
sceneManager = new SceneManager();
create_scene();
onInit();
