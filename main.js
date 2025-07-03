import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// --- GAME STATE ---
let gameState = 'start'; // 'start', 'playing', 'gameOver'

// --- SCENE SETUP ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('game-canvas'), antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; // Enable shadows

// --- UI ELEMENTS ---
const hud = document.getElementById('hud');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayText = document.getElementById('overlay-text');
const healthBar = document.getElementById('health-bar');
const staminaBar = document.getElementById('stamina-bar');

// --- PHYSICS WORLD ---
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) }); // Stronger gravity
const GROUP_PLAYER = 1;
const GROUP_SWORD = 2;
const GROUP_ENEMY = 4;
const GROUP_GROUND = 8;

// --- ASSETS & SOUNDS ---
const textureLoader = new THREE.TextureLoader();
const audioLoader = new THREE.AudioLoader();
const sounds = {};
const audioListener = new THREE.AudioListener();
camera.add(audioListener);

function loadSound(name, path) {
    audioLoader.load(path, (buffer) => {
        sounds[name] = new THREE.Audio(audioListener);
        sounds[name].setBuffer(buffer);
    });
}
loadSound('swing', 'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/swing.mp3?v=1677353139369');
loadSound('clash', 'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/clash.mp3?v=1677353133379');
loadSound('hit', 'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/hit.mp3?v=1677353136200');

// --- LIGHTING & ENVIRONMENT ---
scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(10, 20, 5);
dirLight.castShadow = true;
scene.add(dirLight);

const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.MeshStandardMaterial({ color: 0x808080 })
);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

const groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
    collisionFilterGroup: GROUP_GROUND,
    collisionFilterMask: GROUP_PLAYER | GROUP_ENEMY
});
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(groundBody);

const skyboxLoader = new THREE.CubeTextureLoader();
const skybox = skyboxLoader.load([
    'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/px.png?v=1677353597814', 'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/nx.png?v=1677353594197',
    'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/py.png?v=1677353599020', 'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/ny.png?v=1677353595535',
    'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/pz.png?v=1677353599742', 'https://cdn.glitch.global/e532a89a-53a8-4610-8557-4879a66d3336/nz.png?v=1677353596548'
]);
scene.background = skybox;

// --- CLASSES ---
class Player {
    constructor() {
        this.maxHealth = 100;
        this.health = this.maxHealth;
        this.maxStamina = 100;
        this.stamina = this.maxStamina;

        // Player model (Capsule)
        const radius = 0.5, height = 1;
        this.mesh = new THREE.Mesh(
            new THREE.CapsuleGeometry(radius, height),
            new THREE.MeshStandardMaterial({ color: 0xeeeeee, visible: false })
        );
        this.mesh.castShadow = true;
        scene.add(this.mesh);

        this.body = new CANNON.Body({
            mass: 70,
            shape: new CANNON.Cylinder(radius, radius, height + 2 * radius, 12),
            collisionFilterGroup: GROUP_PLAYER,
            collisionFilterMask: GROUP_GROUND | GROUP_ENEMY
        });
        world.addBody(this.body);

        this.sword = new Sword(GROUP_SWORD, GROUP_ENEMY, 0xC0C0C0);
        this.input = { fwd: 0, back: 0, left: 0, right: 0, jump: false, sprint: false, block: false, kick: false };
        this.mouse = { x: 0, y: 0 };
        this.initEventListeners();
    }

    initEventListeners() {
        const keyMap = { 'KeyW': 'fwd', 'KeyS': 'back', 'KeyA': 'left', 'KeyD': 'right', 'Space': 'jump', 'ShiftLeft': 'sprint', 'KeyF': 'kick' };
        window.addEventListener('keydown', e => { if (keyMap[e.code]) this.input[keyMap[e.code]] = true; });
        window.addEventListener('keyup', e => { if (keyMap[e.code]) this.input[keyMap[e.code]] = false; });
        window.addEventListener('mousedown', e => { if (e.button === 2) this.input.block = true; });
        window.addEventListener('mouseup', e => { if (e.button === 2) this.input.block = false; });
        document.addEventListener('mousemove', e => {
            if (document.pointerLockElement) {
                this.mouse.x += e.movementX;
                this.mouse.y += e.movementY;
            }
        });
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        if (this.health === 0) {
            endGame(false); // Player lost
        }
    }
    
    update(deltaTime) {
        // Stamina regen
        if (!this.input.sprint && !this.input.block) {
            this.stamina = Math.min(this.maxStamina, this.stamina + 15 * deltaTime);
        }
        
        // Movement
        const speed = this.input.sprint && this.stamina > 0 ? 8 : 4;
        if (this.input.sprint) this.stamina = Math.max(0, this.stamina - 30 * deltaTime);

        const moveDir = new THREE.Vector3(this.input.right - this.input.left, 0, this.input.back - this.input.fwd);
        moveDir.normalize().applyAxisAngle(new THREE.Vector3(0,1,0), camera.rotation.y);
        this.body.velocity.x = moveDir.x * speed;
        this.body.velocity.z = moveDir.z * speed;

        // Jump
        if (this.input.jump && this.stamina > 10) {
             // Simple ground check
            const from = new CANNON.Vec3(this.body.position.x, this.body.position.y - 1.5, this.body.position.z);
            const to = new CANNON.Vec3(this.body.position.x, this.body.position.y - 1.6, this.body.position.z);
            const result = new CANNON.RaycastResult();
            if (world.raycastClosest(from, to, {}, result)) {
                this.body.velocity.y = 10;
                this.stamina -= 10;
            }
            this.input.jump = false;
        }

        // Kick
        if (this.input.kick && this.stamina > 20) {
            // Check if enemy is close
            const distance = this.body.position.distanceTo(enemy.body.position);
            if(distance < 2.5) {
                const kickDir = new CANNON.Vec3();
                enemy.body.position.vsub(this.body.position, kickDir);
                kickDir.normalize();
                enemy.body.applyImpulse(kickDir.scale(300), enemy.body.position);
                if(sounds.swing) sounds.swing.play();
            }
            this.stamina -= 20;
            this.input.kick = false;
        }

        // Camera
        camera.position.copy(this.body.position);
        camera.position.y += 1.8;
        camera.rotation.y = -this.mouse.x * 0.002;
        camera.rotation.x = -this.mouse.y * 0.002;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
        
        this.sword.update(camera, this.input.block);
        this.mesh.position.copy(this.body.position);
    }
}

class Enemy {
    constructor() {
        this.maxHealth = 100;
        this.health = this.maxHealth;

        this.mesh = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.5, 1.0),
            new THREE.MeshStandardMaterial({ color: 0xff0000 })
        );
        this.mesh.castShadow = true;
        scene.add(this.mesh);

        this.body = new CANNON.Body({
            mass: 90,
            shape: new CANNON.Cylinder(0.5, 0.5, 2, 12),
            collisionFilterGroup: GROUP_ENEMY,
            collisionFilterMask: GROUP_GROUND | GROUP_PLAYER | GROUP_SWORD
        });
        world.addBody(this.body);

        this.sword = new Sword(GROUP_SWORD, GROUP_PLAYER, 0x505050);

        this.body.addEventListener("collide", (event) => {
            if (event.body === player.sword.body) {
                const impact = event.contact.getImpactVelocityAlongNormal();
                if (Math.abs(impact) > 4) {
                    this.takeDamage(20);
                    if(sounds.hit) sounds.hit.play();
                    // Knockback
                    const impulseDir = new CANNON.Vec3();
                    player.body.position.vsub(this.body.position, impulseDir);
                    impulseDir.normalize();
                    this.body.applyImpulse(impulseDir.scale(-50), this.body.position);
                } else if (Math.abs(impact) > 1) {
                    if(sounds.clash) sounds.clash.play();
                }
            }
        });
    }

    takeDamage(amount) {
        this.health = Math.max(0, this.health - amount);
        this.mesh.material.color.set(0xffffff);
        setTimeout(() => this.mesh.material.color.set(0xff0000), 100);
        if (this.health === 0) {
            endGame(true); // Player won
        }
    }

    update(deltaTime) {
        const distance = this.body.position.distanceTo(player.body.position);
        const direction = new CANNON.Vec3();
        player.body.position.vsub(this.body.position, direction);
        direction.normalize();

        // AI Logic
        if (distance > 3) { // Chase
            this.body.velocity.x = direction.x * 3;
            this.body.velocity.z = direction.z * 3;
        } else { // Attack
            this.body.velocity.x *= 0.8;
            this.body.velocity.z *= 0.8;
            this.sword.attack(this.body.position, player.body.position);
        }
        
        // Face player
        const angle = Math.atan2(direction.x, direction.z);
        this.body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), angle);
        
        this.sword.update(this.mesh, false); // Enemy doesn't block
        this.mesh.position.copy(this.body.position);
        this.mesh.quaternion.copy(this.body.quaternion);
    }
}

class Sword {
    constructor(group, mask, color) {
        this.mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.1, 1.5),
            new THREE.MeshStandardMaterial({ color: color })
        );
        this.mesh.castShadow = true;
        scene.add(this.mesh);

        this.body = new CANNON.Body({
            mass: 2,
            shape: new CANNON.Box(new CANNON.Vec3(0.05, 0.05, 0.75)),
            collisionFilterGroup: group,
            collisionFilterMask: mask | GROUP_GROUND
        });
        world.addBody(this.body);
    }

    update(parent, isBlocking) {
        const target = new THREE.Object3D();
        const armStrength = isBlocking ? 100 : 30; // Stiffer arm when blocking
        const positionOffset = isBlocking ? new THREE.Vector3(0.3, -0.1, -1.2) : new THREE.Vector3(0.5, -0.4, -1.5);
       
        if (parent instanceof THREE.Camera) { // Player's sword
            target.position.copy(positionOffset);
            parent.add(target);
            
            const worldPos = new THREE.Vector3();
            target.getWorldPosition(worldPos);
            
            const force = new CANNON.Vec3();
            worldPos.vsub(this.body.position, force);
            force.scale(armStrength, this.body.velocity);

            const worldQuat = new THREE.Quaternion();
            parent.getWorldQuaternion(worldQuat);
            this.body.quaternion.slerp(worldQuat.clone(), 0.3, this.body.quaternion);

        } else { // Enemy's sword
            this.body.position.copy(parent.position).vadd(new CANNON.Vec3(0,0.5,0.7).applyQuaternion(parent.quaternion), this.body.position);
            this.body.quaternion.copy(parent.quaternion);
        }
        
        this.mesh.position.copy(this.body.position);
        this.mesh.quaternion.copy(this.body.quaternion);
    }
    
    attack(fromPos, toPos) {
        const direction = new CANNON.Vec3();
        toPos.vsub(fromPos, direction);
        direction.normalize();
        this.body.velocity.copy(direction.scale(10));
    }
}

// --- GAME INSTANCES ---
let player, enemy;

function initGame() {
    player = new Player();
    enemy = new Enemy();
    
    player.body.position.set(0, 2, 8);
    enemy.body.position.set(0, 2, 0);
}

function resetGame() {
    player.health = player.maxHealth;
    player.stamina = player.maxStamina;
    player.body.position.set(0, 2, 8);
    player.body.velocity.set(0,0,0);
    player.body.angularVelocity.set(0,0,0);
    
    enemy.health = enemy.maxHealth;
    enemy.body.position.set(0, 2, 0);
    enemy.body.velocity.set(0,0,0);
    enemy.body.angularVelocity.set(0,0,0);

    gameState = 'playing';
    hud.style.display = 'block';
    overlay.style.display = 'none';
    renderer.domElement.requestPointerLock();
}

function endGame(playerWon) {
    gameState = 'gameOver';
    hud.style.display = 'none';
    overlay.style.display = 'block';
    document.exitPointerLock();
    
    if(playerWon) {
        overlayTitle.innerText = "VICTORY";
        overlayText.innerHTML = "You have defeated the Red Knight.<br><br><strong class='pulse'>Press ENTER to Play Again</strong>";
    } else {
        overlayTitle.innerText = "YOU DIED";
        overlayText.innerHTML = "The arena claims another warrior.<br><br><strong class='pulse'>Press ENTER to Try Again</strong>";
    }
}

// --- MAIN LOOP ---
const clock = new THREE.Clock();
let oldElapsedTime = 0;

function animate() {
    requestAnimationFrame(animate);

    const elapsedTime = clock.getElapsedTime();
    const deltaTime = elapsedTime - oldElapsedTime;
    oldElapsedTime = elapsedTime;

    if (gameState === 'playing') {
        world.step(1 / 60, deltaTime, 3);
        player.update(deltaTime);
        enemy.update(deltaTime);
        
        // Update HUD
        healthBar.style.width = (player.health / player.maxHealth) * 100 + '%';
        staminaBar.style.width = (player.stamina / player.maxStamina) * 100 + '%';
    }
    
    renderer.render(scene, camera);
}

// --- EVENT LISTENERS ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' && (gameState === 'start' || gameState === 'gameOver')) {
        resetGame();
    }
});

// Disable right-click context menu
window.addEventListener('contextmenu', e => e.preventDefault());

// --- START ---
initGame();
animate();
