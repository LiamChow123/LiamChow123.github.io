import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// --- SETUP ---
// Scene, Camera, Renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x87ceeb); // Sky blue background
camera.position.z = 5;
camera.position.y = 2;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 7.5);
scene.add(directionalLight);

// Physics World
const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82, 0) // Realistic gravity
});

// --- GAME OBJECTS & PHYSICS ---
const objectsToUpdate = [];

// Ground
const groundGeometry = new THREE.PlaneGeometry(100, 100);
const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
groundMesh.rotation.x = -Math.PI / 2;
scene.add(groundMesh);

const groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
});
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

// Player (represented by a capsule)
const playerShape = new CANNON.Sphere(0.5); 
const playerBody = new CANNON.Body({ mass: 70, shape: playerShape });
playerBody.position.set(0, 5, 0); // Start high to see gravity work
world.addBody(playerBody);

// Sword (the core mechanic!)
const swordGeometry = new THREE.BoxGeometry(0.1, 0.1, 1.5);
const swordMaterial = new THREE.MeshStandardMaterial({ color: 0 C0C0C0 });
const swordMesh = new THREE.Mesh(swordGeometry, swordMaterial);
scene.add(swordMesh);

const swordShape = new CANNON.Box(new CANNON.Vec3(0.05, 0.05, 0.75));
const swordBody = new CANNON.Body({ mass: 2, shape: swordShape });
world.addBody(swordBody);
objectsToUpdate.push({ mesh: swordMesh, body: swordBody });

// A target for the sword to follow (controlled by mouse)
const swordTarget = new THREE.Object3D();
scene.add(swordTarget);

// A "dummy" enemy to hit
const enemyGeometry = new THREE.BoxGeometry(1, 2, 1);
const enemyMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
const enemyMesh = new THREE.Mesh(enemyGeometry, enemyMaterial);
scene.add(enemyMesh);

const enemyShape = new CANNON.Box(new CANNON.Vec3(0.5, 1, 0.5));
const enemyBody = new CANNON.Body({ mass: 50, shape: enemyShape });
enemyBody.position.set(0, 1, -5);
world.addBody(enemyBody);
objectsToUpdate.push({ mesh: enemyMesh, body: enemyBody });

enemyBody.addEventListener("collide", (event) => {
    // Check if the collision is with the sword and is strong enough
    const contact = event.contact;
    const impactVelocity = contact.getImpactVelocityAlongNormal();
    
    if (Math.abs(impactVelocity) > 2) { // Threshold for a "hit"
        console.log("Enemy Hit!");
        enemyMesh.material.color.set(0xffff00); // Flash yellow on hit
        setTimeout(() => enemyMesh.material.color.set(0xff0000), 100);
    }
});


// --- CONTROLS ---
const keys = {};
document.addEventListener('keydown', (e) => (keys[e.code] = true));
document.addEventListener('keyup', (e) => (keys[e.code] = false));

const mouse = new THREE.Vector2();
document.addEventListener('mousemove', (e) => {
    // Normalize mouse position to -1 -> +1
    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

// Lock pointer on click
const infoOverlay = document.getElementById('info-overlay');
infoOverlay.addEventListener('click', () => {
    renderer.domElement.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === renderer.domElement) {
        infoOverlay.style.display = 'none';
    } else {
        infoOverlay.style.display = 'block';
    }
});

// --- GAME LOOP ---
const clock = new THREE.Clock();
let oldElapsedTime = 0;

function animate() {
    requestAnimationFrame(animate);

    const elapsedTime = clock.getElapsedTime();
    const deltaTime = elapsedTime - oldElapsedTime;
    oldElapsedTime = elapsedTime;

    // --- Physics Step ---
    world.step(1 / 60, deltaTime, 3);

    // --- Update Logic ---
    // Player Movement
    const moveSpeed = keys['ShiftLeft'] ? 8 : 4; // Sprinting
    const moveDirection = new THREE.Vector3();
    if (keys['KeyW']) moveDirection.z -= 1;
    if (keys['KeyS']) moveDirection.z += 1;
    if (keys['KeyA']) moveDirection.x -= 1;
    if (keys['KeyD']) moveDirection.x += 1;
    moveDirection.normalize().multiplyScalar(moveSpeed);
    
    // Apply movement relative to camera direction
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    cameraDirection.y = 0; // Don't move up/down
    cameraDirection.normalize();
    
    const right = new THREE.Vector3().crossVectors(camera.up, cameraDirection).normalize();
    const forward = cameraDirection;

    const finalMove = right.multiplyScalar(moveDirection.x).add(forward.multiplyScalar(moveDirection.z));
    playerBody.velocity.x = finalMove.x;
    playerBody.velocity.z = finalMove.z;

    // Jumping
    if (keys['Space']) {
        // A simple way to check if on ground is to raycast down
        // For simplicity here, we just allow jumping
        playerBody.velocity.y = 7; // Jump force
    }

    // Camera follows player
    camera.position.copy(playerBody.position);
    camera.position.y += 1.5; // Eye level

    // Mouse Controls Sword
    if (document.pointerLockElement === renderer.domElement) {
        camera.rotation.y -= event.movementX * 0.002;
        camera.rotation.x -= event.movementY * 0.002;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
    }

    // Sword Follows Mouse/Camera
    // This is the magic: The target is positioned in front of the camera
    swordTarget.position.set(0, -0.2, -2); // Position relative to camera
    camera.add(swordTarget); // Attach target to camera
    
    // Get world position of the target
    const targetWorldPosition = new THREE.Vector3();
    swordTarget.getWorldPosition(targetWorldPosition);

    // Make the sword's physics body move towards the target position
    // This creates the feeling of weight and momentum
    const force = new CANNON.Vec3();
    targetWorldPosition.vsub(swordBody.position, force);
    force.scale(30, swordBody.velocity); // The '30' is the "strength" of your arm

    // Also make the sword orient towards the camera direction
    const cameraQuaternion = new CANNON.Quaternion().setFromEuler(camera.rotation.x, camera.rotation.y, 0);
    swordBody.quaternion.slerp(cameraQuaternion, 0.2, swordBody.quaternion);
    
    // Update visual meshes to match their physics bodies
    for (const obj of objectsToUpdate) {
        obj.mesh.position.copy(obj.body.position);
        obj.mesh.quaternion.copy(obj.body.quaternion);
    }

    // --- Render ---
    renderer.render(scene, camera);
}

// Handle window resizing
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start the game loop
animate();
