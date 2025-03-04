import { Logger } from "../../Misc/logger";
import { Nullable } from "../../types";
import { Camera } from "../../Cameras/camera";
import { Scene } from "../../scene";
import { Vector3 } from "../../Maths/math.vector";
import { Color3, Color4 } from "../../Maths/math.color";
import { Mesh } from "../../Meshes/mesh";
import { AbstractMesh } from "../../Meshes/abstractMesh";
import { Geometry } from "../../Meshes/geometry";
import { Node } from "../../node";
import { TransformNode } from "../../Meshes/transformNode";
import { Material } from "../../Materials/material";
import { MultiMaterial } from "../../Materials/multiMaterial";
import { CubeTexture } from "../../Materials/Textures/cubeTexture";
import { HDRCubeTexture } from "../../Materials/Textures/hdrCubeTexture";
import { AnimationGroup } from "../../Animations/animationGroup";
import { Light } from "../../Lights/light";
import { SceneComponentConstants } from "../../sceneComponent";
import { SceneLoader } from "../../Loading/sceneLoader";
import { AbstractScene } from "../../abstractScene";
import { AssetContainer } from "../../assetContainer";
import { ActionManager } from "../../Actions/actionManager";
import { IParticleSystem } from "../../Particles/IParticleSystem";
import { Skeleton } from "../../Bones/skeleton";
import { MorphTargetManager } from "../../Morph/morphTargetManager";
import { CannonJSPlugin } from "../../Physics/Plugins/cannonJSPlugin";
import { OimoJSPlugin } from "../../Physics/Plugins/oimoJSPlugin";
import { AmmoJSPlugin } from "../../Physics/Plugins/ammoJSPlugin";
import { ReflectionProbe } from "../../Probes/reflectionProbe";
import { GetClass } from '../../Misc/typeStore';
import { Tools } from '../../Misc/tools';
import { PostProcess } from '../../PostProcesses/postProcess';
import { EndsWith } from "../../Misc/stringTools";

/** @hidden */
export var _BabylonLoaderRegistered = true;

/**
 * Helps setting up some configuration for the babylon file loader.
 */
export class BabylonFileLoaderConfiguration {
    /**
     * The loader does not allow injecting custom physics engine into the plugins.
     * Unfortunately in ES6, we need to manually inject them into the plugin.
     * So you could set this variable to your engine import to make it work.
     */
    public static LoaderInjectedPhysicsEngine: any = undefined;
}

var tempIndexContainer: {[key: string]: Node} = {};
const tempMaterialIndexContainer: {[key: string]: Material} = {};

var parseMaterialByPredicate = (predicate: (parsedMaterial: any) => boolean, parsedData: any, scene: Scene, rootUrl: string) => {
    if (!parsedData.materials) {
        return null;
    }

    for (var index = 0, cache = parsedData.materials.length; index < cache; index++) {
        var parsedMaterial = parsedData.materials[index];
        if (predicate(parsedMaterial)) {
            return Material.Parse(parsedMaterial, scene, rootUrl);
        }
    }
    return null;
};

var isDescendantOf = (mesh: any, names: Array<any>, hierarchyIds: Array<number>) => {
    for (var i in names) {
        if (mesh.name === names[i]) {
            hierarchyIds.push(mesh.id);
            return true;
        }
    }
    if (mesh.parentId !== undefined && hierarchyIds.indexOf(mesh.parentId) !== -1) {
        hierarchyIds.push(mesh.id);
        return true;
    }
    return false;
};

var logOperation = (operation: string, producer: { file: string, name: string, version: string, exporter_version: string }) => {
    return operation + " of " + (producer ? producer.file + " from " + producer.name + " version: " + producer.version + ", exporter version: " + producer.exporter_version : "unknown");
};

var loadDetailLevels = (scene: Scene, mesh: AbstractMesh) => {
    const mastermesh: Mesh = mesh as Mesh;

    // Every value specified in the ids array of the lod data points to another mesh which should be used as the lower LOD level.
    // The distances (or coverages) array values specified are used along with the lod mesh ids as a hint to determine the switching threshold for the various LODs.
    if (mesh._waitingData.lods) {
        if (mesh._waitingData.lods.ids && mesh._waitingData.lods.ids.length > 0) {
            const lodmeshes: string[] = mesh._waitingData.lods.ids;
            const wasenabled: boolean = mastermesh.isEnabled(false);
            if (mesh._waitingData.lods.distances) {
                const distances: number[] = mesh._waitingData.lods.distances;
                if (distances.length >= lodmeshes.length) {
                    const culling: number = (distances.length > lodmeshes.length) ? distances[distances.length - 1] : 0;
                    mastermesh.setEnabled(false);
                    for (let index = 0; index < lodmeshes.length; index++) {
                        const lodid: string = lodmeshes[index];
                        const lodmesh: Mesh = scene.getMeshById(lodid) as Mesh;
                        if (lodmesh != null) {
                            mastermesh.addLODLevel(distances[index], lodmesh);
                        }
                    }
                    if (culling > 0) {
                        mastermesh.addLODLevel(culling, null);
                    }
                    if (wasenabled === true) {
                        mastermesh.setEnabled(true);
                    }
                } else {
                    Tools.Warn("Invalid level of detail distances for " + mesh.name);
                }
            }
        }
        mesh._waitingData.lods = null;
    }
};

var findParent = (parentId: any, scene: Scene) => {
    if (typeof parentId !== "number") {
        return scene.getLastEntryById(parentId);
    }

    let parent = tempIndexContainer[parentId];

    return parent;
};

const findMaterial = (materialId: any, scene: Scene) => {
    if (typeof materialId !== "number") {
        return scene.getLastMaterialById(materialId, true);
    }

    return tempMaterialIndexContainer[materialId];
};

var loadAssetContainer = (scene: Scene, data: string, rootUrl: string, onError?: (message: string, exception?: any) => void, addToScene = false): AssetContainer => {
    var container = new AssetContainer(scene);

    // Entire method running in try block, so ALWAYS logs as far as it got, only actually writes details
    // when SceneLoader.debugLogging = true (default), or exception encountered.
    // Everything stored in var log instead of writing separate lines to support only writing in exception,
    // and avoid problems with multiple concurrent .babylon loads.
    var log = "importScene has failed JSON parse";
    try {
        var parsedData = JSON.parse(data);
        log = "";
        var fullDetails = SceneLoader.loggingLevel === SceneLoader.DETAILED_LOGGING;

        var index: number;
        var cache: number;

        // Environment texture
        if (parsedData.environmentTexture !== undefined && parsedData.environmentTexture !== null) {
            // PBR needed for both HDR texture (gamma space) & a sky box
            var isPBR = parsedData.isPBR !== undefined ? parsedData.isPBR : true;
            if (parsedData.environmentTextureType && parsedData.environmentTextureType === "BABYLON.HDRCubeTexture") {
                var hdrSize: number = (parsedData.environmentTextureSize) ? parsedData.environmentTextureSize : 128;
                var hdrTexture = new HDRCubeTexture((parsedData.environmentTexture.match(/https?:\/\//g) ? "" : rootUrl) + parsedData.environmentTexture, scene, hdrSize, true, !isPBR);
                if (parsedData.environmentTextureRotationY) {
                    hdrTexture.rotationY = parsedData.environmentTextureRotationY;
                }
                scene.environmentTexture = hdrTexture;
            } else {
                if (EndsWith(parsedData.environmentTexture, ".env")) {
                    var compressedTexture = new CubeTexture((parsedData.environmentTexture.match(/https?:\/\//g) ? "" : rootUrl) + parsedData.environmentTexture, scene);
                    if (parsedData.environmentTextureRotationY) {
                        compressedTexture.rotationY = parsedData.environmentTextureRotationY;
                    }
                    scene.environmentTexture = compressedTexture;
                } else {
                    var cubeTexture = CubeTexture.CreateFromPrefilteredData((parsedData.environmentTexture.match(/https?:\/\//g) ? "" : rootUrl) + parsedData.environmentTexture, scene);
                    if (parsedData.environmentTextureRotationY) {
                        cubeTexture.rotationY = parsedData.environmentTextureRotationY;
                    }
                    scene.environmentTexture = cubeTexture;
                }
            }
            if (parsedData.createDefaultSkybox === true) {
                var skyboxScale = (scene.activeCamera !== undefined && scene.activeCamera !== null) ? (scene.activeCamera.maxZ - scene.activeCamera.minZ) / 2 : 1000;
                var skyboxBlurLevel = parsedData.skyboxBlurLevel || 0;
                scene.createDefaultSkybox(scene.environmentTexture, isPBR, skyboxScale, skyboxBlurLevel);
            }
            container.environmentTexture = scene.environmentTexture;
        }

        // Environment Intensity
        if (parsedData.environmentIntensity !== undefined && parsedData.environmentIntensity !== null) {
            scene.environmentIntensity = parsedData.environmentIntensity;
        }

        // Lights
        if (parsedData.lights !== undefined && parsedData.lights !== null) {
            for (index = 0, cache = parsedData.lights.length; index < cache; index++) {
                var parsedLight = parsedData.lights[index];
                var light = Light.Parse(parsedLight, scene);
                if (light) {
                    tempIndexContainer[parsedLight.uniqueId] = light;
                    container.lights.push(light);
                    light._parentContainer = container;
                    log += (index === 0 ? "\n\tLights:" : "");
                    log += "\n\t\t" + light.toString(fullDetails);
                }
            }
        }

        // Reflection probes
        if (parsedData.reflectionProbes !== undefined && parsedData.reflectionProbes !== null) {
            for (index = 0, cache = parsedData.reflectionProbes.length; index < cache; index++) {
                var parsedReflectionProbe = parsedData.reflectionProbes[index];
                var reflectionProbe = ReflectionProbe.Parse(parsedReflectionProbe, scene, rootUrl);
                if (reflectionProbe) {
                    container.reflectionProbes.push(reflectionProbe);
                    reflectionProbe._parentContainer = container;
                    log += (index === 0 ? "\n\tReflection Probes:" : "");
                    log += "\n\t\t" + reflectionProbe.toString(fullDetails);
                }
            }
        }

        // Animations
        if (parsedData.animations !== undefined && parsedData.animations !== null) {
            for (index = 0, cache = parsedData.animations.length; index < cache; index++) {
                var parsedAnimation = parsedData.animations[index];
                const internalClass = GetClass("BABYLON.Animation");
                if (internalClass) {
                    let animation = internalClass.Parse(parsedAnimation);
                    scene.animations.push(animation);
                    container.animations.push(animation);
                    log += (index === 0 ? "\n\tAnimations:" : "");
                    log += "\n\t\t" + animation.toString(fullDetails);
                }
            }
        }

        // Materials
        if (parsedData.materials !== undefined && parsedData.materials !== null) {
            for (index = 0, cache = parsedData.materials.length; index < cache; index++) {
                var parsedMaterial = parsedData.materials[index];
                var mat = Material.Parse(parsedMaterial, scene, rootUrl);
                if (mat) {
                    tempMaterialIndexContainer[parsedMaterial.uniqueId || parsedMaterial.id] = mat;
                    container.materials.push(mat);
                    mat._parentContainer = container;
                    log += (index === 0 ? "\n\tMaterials:" : "");
                    log += "\n\t\t" + mat.toString(fullDetails);

                    // Textures
                    var textures = mat.getActiveTextures();
                    textures.forEach((t) => {
                        if (container.textures.indexOf(t) == -1) {
                            container.textures.push(t);
                            t._parentContainer = container;
                        }
                    });
                }
            }
        }

        if (parsedData.multiMaterials !== undefined && parsedData.multiMaterials !== null) {
            for (index = 0, cache = parsedData.multiMaterials.length; index < cache; index++) {
                var parsedMultiMaterial = parsedData.multiMaterials[index];
                var mmat = MultiMaterial.ParseMultiMaterial(parsedMultiMaterial, scene);
                tempMaterialIndexContainer[parsedMultiMaterial.uniqueId || parsedMultiMaterial.id] = mmat;
                container.multiMaterials.push(mmat);
                mmat._parentContainer = container;

                log += (index === 0 ? "\n\tMultiMaterials:" : "");
                log += "\n\t\t" + mmat.toString(fullDetails);

                // Textures
                var textures = mmat.getActiveTextures();
                textures.forEach((t) => {
                    if (container.textures.indexOf(t) == -1) {
                        container.textures.push(t);
                        t._parentContainer = container;
                    }
                });
            }
        }

        // Morph targets
        if (parsedData.morphTargetManagers !== undefined && parsedData.morphTargetManagers !== null) {
            for (var managerData of parsedData.morphTargetManagers) {
                const manager = MorphTargetManager.Parse(managerData, scene);
                container.morphTargetManagers.push(manager);
                manager._parentContainer = container;
            }
        }

        // Skeletons
        if (parsedData.skeletons !== undefined && parsedData.skeletons !== null) {
            for (index = 0, cache = parsedData.skeletons.length; index < cache; index++) {
                var parsedSkeleton = parsedData.skeletons[index];
                var skeleton = Skeleton.Parse(parsedSkeleton, scene);
                container.skeletons.push(skeleton);
                skeleton._parentContainer = container;
                log += (index === 0 ? "\n\tSkeletons:" : "");
                log += "\n\t\t" + skeleton.toString(fullDetails);
            }
        }

        // Geometries
        var geometries = parsedData.geometries;
        if (geometries !== undefined && geometries !== null) {
            var addedGeometry = new Array<Nullable<Geometry>>();

            // VertexData
            var vertexData = geometries.vertexData;
            if (vertexData !== undefined && vertexData !== null) {
                for (index = 0, cache = vertexData.length; index < cache; index++) {
                    var parsedVertexData = vertexData[index];
                    addedGeometry.push(Geometry.Parse(parsedVertexData, scene, rootUrl));
                }
            }

            addedGeometry.forEach((g) => {
                if (g) {
                    container.geometries.push(g);
                    g._parentContainer = container;
                }
            });
        }

        // Transform nodes
        if (parsedData.transformNodes !== undefined && parsedData.transformNodes !== null) {
            for (index = 0, cache = parsedData.transformNodes.length; index < cache; index++) {
                var parsedTransformNode = parsedData.transformNodes[index];
                var node = TransformNode.Parse(parsedTransformNode, scene, rootUrl);
                tempIndexContainer[parsedTransformNode.uniqueId] = node;
                container.transformNodes.push(node);
                node._parentContainer = container;
            }
        }

        // Meshes
        if (parsedData.meshes !== undefined && parsedData.meshes !== null) {
            for (index = 0, cache = parsedData.meshes.length; index < cache; index++) {
                var parsedMesh = parsedData.meshes[index];
                var mesh = <AbstractMesh>Mesh.Parse(parsedMesh, scene, rootUrl);
                tempIndexContainer[parsedMesh.uniqueId] = mesh;
                container.meshes.push(mesh);
                mesh._parentContainer = container;
                if (mesh.hasInstances) {
                    for (var instance of (mesh as Mesh).instances) {
                        container.meshes.push(instance);
                        instance._parentContainer = container;
                    }
                }
                log += (index === 0 ? "\n\tMeshes:" : "");
                log += "\n\t\t" + mesh.toString(fullDetails);
            }
        }

        // Cameras
        if (parsedData.cameras !== undefined && parsedData.cameras !== null) {
            for (index = 0, cache = parsedData.cameras.length; index < cache; index++) {
                var parsedCamera = parsedData.cameras[index];
                var camera = Camera.Parse(parsedCamera, scene);
                tempIndexContainer[parsedCamera.uniqueId] = camera;
                container.cameras.push(camera);
                camera._parentContainer = container;
                log += (index === 0 ? "\n\tCameras:" : "");
                log += "\n\t\t" + camera.toString(fullDetails);
            }
        }

        // Postprocesses
        if (parsedData.postProcesses !== undefined && parsedData.postProcesses !== null) {
            for (index = 0, cache = parsedData.postProcesses.length; index < cache; index++) {
                var parsedPostProcess = parsedData.postProcesses[index];
                var postProcess = PostProcess.Parse(parsedPostProcess, scene, rootUrl);
                if (postProcess) {
                    container.postProcesses.push(postProcess);
                    postProcess._parentContainer = container;
                    log += (index === 0 ? "\n\Postprocesses:" : "");
                    log += "\n\t\t" + postProcess.toString();
                }
            }
        }

        // Animation Groups
        if (parsedData.animationGroups !== undefined && parsedData.animationGroups !== null) {
            for (index = 0, cache = parsedData.animationGroups.length; index < cache; index++) {
                var parsedAnimationGroup = parsedData.animationGroups[index];
                var animationGroup = AnimationGroup.Parse(parsedAnimationGroup, scene);
                container.animationGroups.push(animationGroup);
                animationGroup._parentContainer = container;
                log += (index === 0 ? "\n\tAnimationGroups:" : "");
                log += "\n\t\t" + animationGroup.toString(fullDetails);
            }
        }

        // Browsing all the graph to connect the dots
        for (index = 0, cache = scene.cameras.length; index < cache; index++) {
            var camera = scene.cameras[index];
            if (camera._waitingParentId !== null) {
                camera.parent = findParent(camera._waitingParentId, scene);
                camera._waitingParentId = null;
            }
        }

        for (index = 0, cache = scene.lights.length; index < cache; index++) {
            let light = scene.lights[index];
            if (light && light._waitingParentId !== null) {
                light.parent = findParent(light._waitingParentId, scene);
                light._waitingParentId = null;
            }
        }

        // Connect parents & children and parse actions and lods
        for (index = 0, cache = scene.transformNodes.length; index < cache; index++) {
            var transformNode = scene.transformNodes[index];
            if (transformNode._waitingParentId !== null) {
                transformNode.parent = findParent(transformNode._waitingParentId, scene);
                transformNode._waitingParentId = null;
            }
        }
        for (index = 0, cache = scene.meshes.length; index < cache; index++) {
            var mesh = scene.meshes[index];
            if (mesh._waitingParentId !== null) {
                mesh.parent = findParent(mesh._waitingParentId, scene);
                mesh._waitingParentId = null;
            }
            if (mesh._waitingData.lods) {
                loadDetailLevels(scene, mesh);
            }
        }

        // link multimats with materials
        scene.multiMaterials.forEach((multimat) => {
                multimat._waitingSubMaterialsUniqueIds.forEach((subMaterial) => {
                    multimat.subMaterials.push(findMaterial(subMaterial, scene));
                });
                multimat._waitingSubMaterialsUniqueIds = [];
        });

        // link meshes with materials
        scene.meshes.forEach((mesh) => {
            if (mesh._waitingMaterialId !== null) {
                mesh.material = findMaterial(mesh._waitingMaterialId, scene);
                mesh._waitingMaterialId = null;
            }
        });

        // link skeleton transform nodes
        for (index = 0, cache = scene.skeletons.length; index < cache; index++) {
            var skeleton = scene.skeletons[index];
            if (skeleton._hasWaitingData) {
                if (skeleton.bones != null) {
                    skeleton.bones.forEach((bone) => {
                        if (bone._waitingTransformNodeId) {
                            var linkTransformNode = scene.getLastEntryById(bone._waitingTransformNodeId) as TransformNode;
                            if (linkTransformNode) {
                                bone.linkTransformNode(linkTransformNode);
                            }
                            bone._waitingTransformNodeId = null;
                        }
                    });
                }

                skeleton._hasWaitingData = null;
            }
        }

        // freeze world matrix application
        for (index = 0, cache = scene.meshes.length; index < cache; index++) {
            var currentMesh = scene.meshes[index];
            if (currentMesh._waitingData.freezeWorldMatrix) {
                currentMesh.freezeWorldMatrix();
                currentMesh._waitingData.freezeWorldMatrix = null;
            } else {
                currentMesh.computeWorldMatrix(true);
            }
        }

        // Lights exclusions / inclusions
        for (index = 0, cache = scene.lights.length; index < cache; index++) {
            let light = scene.lights[index];
            // Excluded check
            if (light._excludedMeshesIds.length > 0) {
                for (var excludedIndex = 0; excludedIndex < light._excludedMeshesIds.length; excludedIndex++) {
                    var excludedMesh = scene.getMeshById(light._excludedMeshesIds[excludedIndex]);

                    if (excludedMesh) {
                        light.excludedMeshes.push(excludedMesh);
                    }
                }

                light._excludedMeshesIds = [];
            }

            // Included check
            if (light._includedOnlyMeshesIds.length > 0) {
                for (var includedOnlyIndex = 0; includedOnlyIndex < light._includedOnlyMeshesIds.length; includedOnlyIndex++) {
                    var includedOnlyMesh = scene.getMeshById(light._includedOnlyMeshesIds[includedOnlyIndex]);

                    if (includedOnlyMesh) {
                        light.includedOnlyMeshes.push(includedOnlyMesh);
                    }
                }

                light._includedOnlyMeshesIds = [];
            }
        }

        AbstractScene.Parse(parsedData, scene, container, rootUrl);

        // Actions (scene) Done last as it can access other objects.
        for (index = 0, cache = scene.meshes.length; index < cache; index++) {
            var mesh = scene.meshes[index];
            if (mesh._waitingData.actions) {
                ActionManager.Parse(mesh._waitingData.actions, mesh, scene);
                mesh._waitingData.actions = null;
            }
        }
        if (parsedData.actions !== undefined && parsedData.actions !== null) {
            ActionManager.Parse(parsedData.actions, null, scene);
        }
    } catch (err) {
        let msg = logOperation("loadAssets", parsedData ? parsedData.producer : "Unknown") + log;
        if (onError) {
            onError(msg, err);
        } else {
            Logger.Log(msg);
            throw err;
        }
    } finally {
        tempIndexContainer = {};

        if (!addToScene) {
            container.removeAllFromScene();
        }
        if (log !== null && SceneLoader.loggingLevel !== SceneLoader.NO_LOGGING) {
            Logger.Log(logOperation("loadAssets", parsedData ? parsedData.producer : "Unknown") + (SceneLoader.loggingLevel !== SceneLoader.MINIMAL_LOGGING ? log : ""));
        }
    }

    return container;
};

SceneLoader.RegisterPlugin({
    name: "babylon.js",
    extensions: ".babylon",
    canDirectLoad: (data: string) => {
        if (data.indexOf("babylon") !== -1) { // We consider that the producer string is filled
            return true;
        }

        return false;
    },
    importMesh: (meshesNames: any, scene: Scene, data: any, rootUrl: string, meshes: AbstractMesh[], particleSystems: IParticleSystem[], skeletons: Skeleton[], onError?: (message: string, exception?: any) => void): boolean => {
        // Entire method running in try block, so ALWAYS logs as far as it got, only actually writes details
        // when SceneLoader.debugLogging = true (default), or exception encountered.
        // Everything stored in var log instead of writing separate lines to support only writing in exception,
        // and avoid problems with multiple concurrent .babylon loads.
        var log = "importMesh has failed JSON parse";
        try {
            var parsedData = JSON.parse(data);
            log = "";
            var fullDetails = SceneLoader.loggingLevel === SceneLoader.DETAILED_LOGGING;
            if (!meshesNames) {
                meshesNames = null;
            } else if (!Array.isArray(meshesNames)) {
                meshesNames = [meshesNames];
            }

            var hierarchyIds = new Array<number>();

            // Transform nodes (the overall idea is to load all of them as this is super fast and then get rid of the ones we don't need)
            var loadedTransformNodes = [];
            if (parsedData.transformNodes !== undefined && parsedData.transformNodes !== null) {
                for (index = 0, cache = parsedData.transformNodes.length; index < cache; index++) {
                    const parsedTransformNode = parsedData.transformNodes[index];
                    loadedTransformNodes.push(TransformNode.Parse(parsedTransformNode, scene, rootUrl));
                }
            }

            if (parsedData.meshes !== undefined && parsedData.meshes !== null) {
                var loadedSkeletonsIds = [];
                var loadedMaterialsIds : string[] = [];
                const loadedMaterialsUniqueIds : string[] = [];
                var loadedMorphTargetsIds = [];
                var index: number;
                var cache: number;
                for (index = 0, cache = parsedData.meshes.length; index < cache; index++) {
                    var parsedMesh = parsedData.meshes[index];

                    if (meshesNames === null || isDescendantOf(parsedMesh, meshesNames, hierarchyIds)) {
                        if (meshesNames !== null) {
                            // Remove found mesh name from list.
                            delete meshesNames[meshesNames.indexOf(parsedMesh.name)];
                        }

                        //Geometry?
                        if (parsedMesh.geometryId !== undefined && parsedMesh.geometryId !== null) {
                            //does the file contain geometries?
                            if (parsedData.geometries !== undefined && parsedData.geometries !== null) {
                                //find the correct geometry and add it to the scene
                                var found: boolean = false;
                                ["boxes", "spheres", "cylinders", "toruses", "grounds", "planes", "torusKnots", "vertexData"].forEach((geometryType: string) => {
                                    if (found === true || !parsedData.geometries[geometryType] || !(Array.isArray(parsedData.geometries[geometryType]))) {
                                        return;
                                    } else {
                                        parsedData.geometries[geometryType].forEach((parsedGeometryData: any) => {
                                            if (parsedGeometryData.id === parsedMesh.geometryId) {
                                                switch (geometryType) {
                                                    case "vertexData":
                                                        Geometry.Parse(parsedGeometryData, scene, rootUrl);
                                                        break;
                                                }
                                                found = true;
                                            }
                                        });

                                    }
                                });
                                if (found === false) {
                                    Logger.Warn("Geometry not found for mesh " + parsedMesh.id);
                                }
                            }
                        }

                        // Material ?
                        if (parsedMesh.materialUniqueId || parsedMesh.materialId) {
                            // if we have a unique ID, look up and store in loadedMaterialsUniqueIds, else use loadedMaterialsIds
                            const materialArray = parsedMesh.materialUniqueId ? loadedMaterialsUniqueIds : loadedMaterialsIds;
                            var materialFound = (materialArray.indexOf(parsedMesh.materialUniqueId || parsedMesh.materialId) !== -1);
                            if (materialFound === false && parsedData.multiMaterials !== undefined && parsedData.multiMaterials !== null) {
                                // Loads a submaterial of a multimaterial
                                const loadSubMaterial = (subMatId: string, predicate: (parsedMaterial: any) => boolean) => {
                                    materialArray.push(subMatId);
                                    var mat = parseMaterialByPredicate(predicate, parsedData, scene, rootUrl);
                                    if (mat) {
                                        log += "\n\tMaterial " + mat.toString(fullDetails);
                                    }
                                };
                                for (var multimatIndex = 0, multimatCache = parsedData.multiMaterials.length; multimatIndex < multimatCache; multimatIndex++) {
                                    const parsedMultiMaterial = parsedData.multiMaterials[multimatIndex];
                                    if ((parsedMesh.materialUniqueId && parsedMultiMaterial.uniqueId === parsedMesh.materialUniqueId) || parsedMultiMaterial.id === parsedMesh.materialId) {
                                        if (parsedMultiMaterial.materialsUniqueIds) { // if the materials inside the multimat are stored by unique id
                                            parsedMultiMaterial.materialsUniqueIds.forEach((subMatId: string) => loadSubMaterial(subMatId, (parsedMaterial) => parsedMaterial.uniqueId === subMatId));
                                        } else { // if the mats are stored by id instead
                                            parsedMultiMaterial.materials.forEach((subMatId: string) => loadSubMaterial(subMatId, (parsedMaterial) => parsedMaterial.id === subMatId));
                                        }
                                        materialArray.push(parsedMultiMaterial.uniqueId || parsedMultiMaterial.id);
                                        var mmat = MultiMaterial.ParseMultiMaterial(parsedMultiMaterial, scene);
                                        tempMaterialIndexContainer[parsedMultiMaterial.uniqueId || parsedMultiMaterial.id] = mmat;
                                        if (mmat) {
                                            materialFound = true;
                                            log += "\n\tMulti-Material " + mmat.toString(fullDetails);
                                        }
                                        break;
                                    }
                                }
                            }

                            if (materialFound === false) {
                                materialArray.push(parsedMesh.materialUniqueId || parsedMesh.materialId);
                                var mat = parseMaterialByPredicate((parsedMaterial) => (parsedMesh.MaterialUniqueId && parsedMaterial.uniqueId === parsedMesh.materialUniqueId || parsedMaterial.id === parsedMesh.materialId), parsedData, scene, rootUrl);
                                if (!mat) {
                                    Logger.Warn("Material not found for mesh " + parsedMesh.id);
                                } else {
                                    log += "\n\tMaterial " + mat.toString(fullDetails);
                                }
                            }
                        }

                        // Skeleton ?
                        if (parsedMesh.skeletonId > -1 && parsedData.skeletons !== undefined && parsedData.skeletons !== null) {
                            var skeletonAlreadyLoaded = (loadedSkeletonsIds.indexOf(parsedMesh.skeletonId) > -1);
                            if (!skeletonAlreadyLoaded) {
                                for (var skeletonIndex = 0, skeletonCache = parsedData.skeletons.length; skeletonIndex < skeletonCache; skeletonIndex++) {
                                    var parsedSkeleton = parsedData.skeletons[skeletonIndex];
                                    if (parsedSkeleton.id === parsedMesh.skeletonId) {
                                        var skeleton = Skeleton.Parse(parsedSkeleton, scene);
                                        skeletons.push(skeleton);
                                        loadedSkeletonsIds.push(parsedSkeleton.id);
                                        log += "\n\tSkeleton " + skeleton.toString(fullDetails);
                                    }
                                }
                            }
                        }

                        // Morph targets ?
                        if (parsedMesh.morphTargetManagerId > -1 && parsedData.morphTargetManagers !== undefined && parsedData.morphTargetManagers !== null) {
                            var morphTargetAlreadyLoaded = (loadedMorphTargetsIds.indexOf(parsedMesh.morphTargetManagerId) > -1);
                            if (!morphTargetAlreadyLoaded) {
                                for (var morphTargetIndex = 0, morphTargetCache = parsedData.morphTargetManagers.length; morphTargetIndex < morphTargetCache; morphTargetIndex++) {
                                    var parsedMorphTarget = parsedData.morphTargetManagers[morphTargetIndex];
                                    if (parsedMorphTarget.id === parsedMesh.morphTargetManagerId) {
                                        var morphTarget = MorphTargetManager.Parse(parsedMorphTarget, scene);
                                        loadedMorphTargetsIds.push(morphTarget.uniqueId);
                                        log += "\n\Morph target " + morphTarget.toString();
                                    }
                                }
                            }
                        }

                        var mesh = Mesh.Parse(parsedMesh, scene, rootUrl);
                        meshes.push(mesh);
                        log += "\n\tMesh " + mesh.toString(fullDetails);
                    }
                }

                 // link multimats with materials
                scene.multiMaterials.forEach((multimat) => {
                    multimat._waitingSubMaterialsUniqueIds.forEach((subMaterial) => {
                        multimat.subMaterials.push(findMaterial(subMaterial, scene));
                    });
                    multimat._waitingSubMaterialsUniqueIds = [];
                });

                // link meshes with materials
                scene.meshes.forEach((mesh) => {
                    if (mesh._waitingMaterialId !== null) {
                        mesh.material = findMaterial(mesh._waitingMaterialId, scene);
                        mesh._waitingMaterialId = null;
                    }
                });

                // Connecting parents and lods
                for (index = 0, cache = scene.transformNodes.length; index < cache; index++) {
                    var transformNode = scene.transformNodes[index];
                    if (transformNode._waitingParentId !== null) {
                        transformNode.parent = scene.getLastEntryById(transformNode._waitingParentId);
                        transformNode._waitingParentId = null;
                    }
                }
                var currentMesh: AbstractMesh;
                for (index = 0, cache = scene.meshes.length; index < cache; index++) {
                    currentMesh = scene.meshes[index];
                    if (currentMesh._waitingParentId) {
                        currentMesh.parent = scene.getLastEntryById(currentMesh._waitingParentId);
                        if (currentMesh.parent?.getClassName() === "TransformNode") {
                            const loadedTransformNodeIndex = loadedTransformNodes.indexOf(currentMesh.parent as TransformNode);
                            if (loadedTransformNodeIndex > -1) {
                                loadedTransformNodes.splice(loadedTransformNodeIndex, 1);
                            }
                        }
                        currentMesh._waitingParentId = null;
                    }
                    if (currentMesh._waitingData.lods) {
                        loadDetailLevels(scene, currentMesh);
                    }
                }

                // Remove unused transform nodes
                for (const transformNode of loadedTransformNodes) {
                    transformNode.dispose();
                }

                // link skeleton transform nodes
                for (index = 0, cache = scene.skeletons.length; index < cache; index++) {
                    var skeleton = scene.skeletons[index];
                    if (skeleton._hasWaitingData) {
                        if (skeleton.bones != null) {
                            skeleton.bones.forEach((bone) => {
                                if (bone._waitingTransformNodeId) {
                                    var linkTransformNode = scene.getLastEntryById(bone._waitingTransformNodeId) as TransformNode;
                                    if (linkTransformNode) {
                                        bone.linkTransformNode(linkTransformNode);
                                    }
                                    bone._waitingTransformNodeId = null;
                                }
                            });
                        }

                        skeleton._hasWaitingData = null;
                    }
                }

                // freeze and compute world matrix application
                for (index = 0, cache = scene.meshes.length; index < cache; index++) {
                    currentMesh = scene.meshes[index];
                    if (currentMesh._waitingData.freezeWorldMatrix) {
                        currentMesh.freezeWorldMatrix();
                        currentMesh._waitingData.freezeWorldMatrix = null;
                    } else {
                        currentMesh.computeWorldMatrix(true);
                    }
                }
            }

            // Particles
            if (parsedData.particleSystems !== undefined && parsedData.particleSystems !== null) {
                let parser = AbstractScene.GetIndividualParser(SceneComponentConstants.NAME_PARTICLESYSTEM);
                if (parser) {
                    for (index = 0, cache = parsedData.particleSystems.length; index < cache; index++) {
                        var parsedParticleSystem = parsedData.particleSystems[index];
                        if (hierarchyIds.indexOf(parsedParticleSystem.emitterId) !== -1) {
                            particleSystems.push(parser(parsedParticleSystem, scene, rootUrl));
                        }
                    }
                }
            }

            return true;

        } catch (err) {
            let msg = logOperation("importMesh", parsedData ? parsedData.producer : "Unknown") + log;
            if (onError) {
                onError(msg, err);
            } else {
                Logger.Log(msg);
                throw err;
            }
        } finally {
            if (log !== null && SceneLoader.loggingLevel !== SceneLoader.NO_LOGGING) {
                Logger.Log(logOperation("importMesh", parsedData ? parsedData.producer : "Unknown") + (SceneLoader.loggingLevel !== SceneLoader.MINIMAL_LOGGING ? log : ""));
            }
        }

        return false;
    },
    load: (scene: Scene, data: string, rootUrl: string, onError?: (message: string, exception?: any) => void): boolean => {
        // Entire method running in try block, so ALWAYS logs as far as it got, only actually writes details
        // when SceneLoader.debugLogging = true (default), or exception encountered.
        // Everything stored in var log instead of writing separate lines to support only writing in exception,
        // and avoid problems with multiple concurrent .babylon loads.
        var log = "importScene has failed JSON parse";
        try {
            var parsedData = JSON.parse(data);
            log = "";

            // Scene
            if (parsedData.useDelayedTextureLoading !== undefined && parsedData.useDelayedTextureLoading !== null) {
                scene.useDelayedTextureLoading = parsedData.useDelayedTextureLoading && !SceneLoader.ForceFullSceneLoadingForIncremental;
            }
            if (parsedData.autoClear !== undefined && parsedData.autoClear !== null) {
                scene.autoClear = parsedData.autoClear;
            }
            if (parsedData.clearColor !== undefined && parsedData.clearColor !== null) {
                scene.clearColor = Color4.FromArray(parsedData.clearColor);
            }
            if (parsedData.ambientColor !== undefined && parsedData.ambientColor !== null) {
                scene.ambientColor = Color3.FromArray(parsedData.ambientColor);
            }
            if (parsedData.gravity !== undefined && parsedData.gravity !== null) {
                scene.gravity = Vector3.FromArray(parsedData.gravity);
            }

            if (parsedData.useRightHandedSystem !== undefined) {
                scene.useRightHandedSystem = !!parsedData.useRightHandedSystem;
            }

            // Fog
            if (parsedData.fogMode && parsedData.fogMode !== 0) {
                scene.fogMode = parsedData.fogMode;
                scene.fogColor = Color3.FromArray(parsedData.fogColor);
                scene.fogStart = parsedData.fogStart;
                scene.fogEnd = parsedData.fogEnd;
                scene.fogDensity = parsedData.fogDensity;
                log += "\tFog mode for scene:  ";
                switch (scene.fogMode) {
                    // getters not compiling, so using hardcoded
                    case 1: log += "exp\n"; break;
                    case 2: log += "exp2\n"; break;
                    case 3: log += "linear\n"; break;
                }
            }

            //Physics
            if (parsedData.physicsEnabled) {
                var physicsPlugin;
                if (parsedData.physicsEngine === "cannon") {
                    physicsPlugin = new CannonJSPlugin(undefined, undefined, BabylonFileLoaderConfiguration.LoaderInjectedPhysicsEngine);
                } else if (parsedData.physicsEngine === "oimo") {
                    physicsPlugin = new OimoJSPlugin(undefined, BabylonFileLoaderConfiguration.LoaderInjectedPhysicsEngine);
                } else if (parsedData.physicsEngine === "ammo") {
                    physicsPlugin = new AmmoJSPlugin(undefined, BabylonFileLoaderConfiguration.LoaderInjectedPhysicsEngine, undefined);
                }
                log = "\tPhysics engine " + (parsedData.physicsEngine ? parsedData.physicsEngine : "oimo") + " enabled\n";
                //else - default engine, which is currently oimo
                var physicsGravity = parsedData.physicsGravity ? Vector3.FromArray(parsedData.physicsGravity) : null;
                scene.enablePhysics(physicsGravity, physicsPlugin);
            }

            // Metadata
            if (parsedData.metadata !== undefined && parsedData.metadata !== null) {
                scene.metadata = parsedData.metadata;
            }

            //collisions, if defined. otherwise, default is true
            if (parsedData.collisionsEnabled !== undefined && parsedData.collisionsEnabled !== null) {
                scene.collisionsEnabled = parsedData.collisionsEnabled;
            }

            var container = loadAssetContainer(scene, data, rootUrl, onError, true);
            if (!container) {
                return false;
            }

            if (parsedData.autoAnimate) {
                scene.beginAnimation(scene, parsedData.autoAnimateFrom, parsedData.autoAnimateTo, parsedData.autoAnimateLoop, parsedData.autoAnimateSpeed || 1.0);
            }

            if (parsedData.activeCameraID !== undefined && parsedData.activeCameraID !== null) {
                scene.setActiveCameraById(parsedData.activeCameraID);
            }

            // Finish
            return true;
        } catch (err) {
            let msg = logOperation("importScene", parsedData ? parsedData.producer : "Unknown") + log;
            if (onError) {
                onError(msg, err);
            } else {
                Logger.Log(msg);
                throw err;
            }
        } finally {
            if (log !== null && SceneLoader.loggingLevel !== SceneLoader.NO_LOGGING) {
                Logger.Log(logOperation("importScene", parsedData ? parsedData.producer : "Unknown") + (SceneLoader.loggingLevel !== SceneLoader.MINIMAL_LOGGING ? log : ""));
            }
        }
        return false;
    },
    loadAssetContainer: (scene: Scene, data: string, rootUrl: string, onError?: (message: string, exception?: any) => void): AssetContainer => {
        var container = loadAssetContainer(scene, data, rootUrl, onError);
        return container;
    }
});
