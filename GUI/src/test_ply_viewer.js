// Imports from Import Map
import * as THREE from 'three';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';

// --- Configuration ---
const FRAME_COUNT = 49;
const BASE_PATH = '../ply_output/ply_output/frame_';
const FRAME_DELAY = 100; // ms

// --- Globals ---
let scene, camera, renderer, controls;
let currentPoints = null;
let currentFrame = 0;
let isPlaying = false;
let globalOffset = null; // To center the model based on the first frame

// --- Input State ---
const inputState = {
    w: false, a: false, s: false, d: false,
    speed: 0.1 // Movement speed
};

// --- Elements ---
const elFrame = document.getElementById('frame-count');
const elStatus = document.getElementById('status');
const elProgress = document.getElementById('progress-fill');

function init() {
    // Scene
    scene = new THREE.Scene();
    // Grid helper for orientation
    const gridHelper = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    scene.add(gridHelper);
    
    // Axes helper
    const axesHelper = new THREE.AxesHelper(1);
    scene.add(axesHelper);

    // Camera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 2, 5); // Adjusted for better view
    camera.lookAt(0, 0, 0);

    // Renderer
    // WebGLRenderer uses hardware acceleration by default.
    // 'powerPreference: "high-performance"' hints the UA to use the discrete GPU on dual-GPU systems.
    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    document.body.appendChild(renderer.domElement);

    // Controls
    // Switched to TrackballControls to allow 360-degree rotation on all axes
    controls = new TrackballControls(camera, renderer.domElement);
    controls.rotateSpeed = 3.0;
    controls.zoomSpeed = 1.2;
    controls.panSpeed = 0.8;
    controls.staticMoving = true; // Set to false for momentum/damping
    
    // Window Resize
    window.addEventListener('resize', onWindowResize, false);
    
    // Keyboard Listeners
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (inputState.hasOwnProperty(key)) inputState[key] = true;
    });
    
    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (inputState.hasOwnProperty(key)) inputState[key] = false;
    });

    // Start Animation Loop (rendering)
    animate();

    // Start Loading Sequence
    startPlayback();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    controls.handleResize();
}

function animate() {
    requestAnimationFrame(animate);
    
    // Handle WASD Movement (Pan Camera View)
    if (inputState.w || inputState.a || inputState.s || inputState.d) {
        const moveVector = new THREE.Vector3();
        
        // Get Camera's local Right and Up vectors
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
        const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
        
        if (inputState.w) moveVector.add(up);    // Up
        if (inputState.s) moveVector.sub(up);    // Down
        if (inputState.a) moveVector.sub(right); // Left
        if (inputState.d) moveVector.add(right); // Right
        
        if (moveVector.lengthSq() > 0) {
            moveVector.normalize().multiplyScalar(inputState.speed);
            camera.position.add(moveVector);
            controls.target.add(moveVector); // Move the pivot point with the camera
        }
    }

    controls.update();
    renderer.render(scene, camera);
}

async function startPlayback() {
    isPlaying = true;
    elStatus.textContent = "Loading Sequence...";

    for (let i = 0; i < FRAME_COUNT; i++) {
        const startTime = performance.now();
        currentFrame = i;
        const paddedIndex = String(i).padStart(4, '0');
        const filename = `${BASE_PATH}${paddedIndex}.ply`;
        
        try {
            await loadAndDisplayPLY(filename);
            
            const endTime = performance.now();
            const frameTime = endTime - startTime;
            const actualDelay = Math.max(0, FRAME_DELAY - frameTime);
            
            const loadSpeedMsg = `Load Time: ${Math.round(frameTime)}ms`;
            updateUI(i, loadSpeedMsg);

            await new Promise(r => setTimeout(r, actualDelay)); // Wait for viewing
        } catch (e) {
            console.error(`Error loading frame ${i}:`, e);
            elStatus.textContent = `Error: ${e.message}`;
            break;
        }
    }

    elStatus.textContent = "Sequence Complete";
    isPlaying = false;
}

function updateUI(frameIndex, speedMsg) {
    elFrame.textContent = `${frameIndex} (${speedMsg})`;
    const pct = ((frameIndex + 1) / FRAME_COUNT) * 100;
    elProgress.style.width = `${pct}%`;
}

// Global material for points
const pointMaterial = new THREE.PointsMaterial({ 
    size: 0.02, 
    color: 0xffffff,
    sizeAttenuation: true 
});

const loader = new PLYLoader();

function loadAndDisplayPLY(url) {
    return new Promise((resolve, reject) => {
        // Note: In typical Gauassian Splatting PLYs, scale might be arbitrary.
        // We might need to adjust camera or object scale.
        
        loader.load(url, (geometry) => {
            // Remove previous frame
            if (currentPoints) {
                scene.remove(currentPoints);
                currentPoints.geometry.dispose();
                // Material is reused, no Dispose
            }

            // Create new points
            // Note: Gaussian Splatting PLY usually has 'x,y,z' which loader handles.
            // It puts them in BufferGeometry 'position' attribute.
            
            // --- FILTERING TRANSPARENT POINTS ---
            // 3DGS "opacity" property is usually a Logit (Inverse Sigmoid).
            // We filter points that would be nearly invisible (opacity < ~10-15%).
            // Sigmoid(x) = 1/(1+exp(-x)). Threshold 0.15 corresponds to x > -1.73
            
            let displayGeometry = geometry;
            const opacityAttr = geometry.attributes['opacity'];
            
            if (opacityAttr) {
                const positions = geometry.attributes.position.array;
                const opacities = opacityAttr.array;
                const filteredPositions = [];
                
                // Threshold: If sigmoid(opacity) < 0.15, discard.
                // logit(0.15) ≈ -1.73. Let's use -2.0 (approx 12%) as cutoff.
                const OPACITY_THRESHOLD_LOGIT = -2.0;

                for(let i = 0; i < opacities.length; i++) {
                    if (opacities[i] > OPACITY_THRESHOLD_LOGIT) {
                        filteredPositions.push(
                            positions[i * 3],
                            positions[i * 3 + 1],
                            positions[i * 3 + 2]
                        );
                    }
                }
                
                if (filteredPositions.length > 0) {
                    displayGeometry = new THREE.BufferGeometry();
                    displayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(filteredPositions, 3));
                    console.log(`Filtered points: ${opacities.length} -> ${filteredPositions.length / 3}`);
                }
            }

            // --- CENTERING ---
            // Center geometry based on VISIBLE points of the first frame
            displayGeometry.computeBoundingBox();
            
            // Calc global offset from the first frame that has enough points
            const POINT_THRESHOLD = 50; 
            const pointCount = displayGeometry.attributes.position.count;

            if (!globalOffset && pointCount > POINT_THRESHOLD) {
                const center = new THREE.Vector3();
                displayGeometry.boundingBox.getCenter(center);
                globalOffset = center.clone().negate();
                console.log(`Global Offset set from filtered frame:`, globalOffset);
            }
            
            // Apply offset if available
            if (globalOffset) {
                displayGeometry.translate(globalOffset.x, globalOffset.y, globalOffset.z);
            }
            
            const points = new THREE.Points(displayGeometry, pointMaterial);
            
            // Rotation removed as requested. Displaying raw coordinates.
            points.rotation.x = 0;
            points.rotation.y = 0;
            points.rotation.z = 0;
            
            scene.add(points);
            currentPoints = points;
            
            resolve();
        }, undefined, (err) => {
            reject(err);
        });
    });
}

init();
