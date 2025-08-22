import express from "express";
import { MET } from "bing-translate-api";
import { Client } from "@gradio/client";
import axios from "axios";
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.SERVER_PORT || process.env.PORT || 7621;
const COOKIE_FILE_PATH = path.join(process.cwd(), 'cookies.txt');

// --- Configuration ---
let authenticatedUserID = null; // Will be fetched
const MAIN_GAME_UNIVERSE_ID =  "7677908852"; // Default or from env
const GRANT_ASSET_PERMISSIONS = true; // Defaults to false
const BYPASS_MODERATION_WAIT = true; // Defaults to false

if (BYPASS_MODERATION_WAIT) {
    console.warn("WARNING: BYPASS_MODERATION_WAIT is enabled. Will not wait for 'Approved' status if 'Reviewing'.");
}
if (GRANT_ASSET_PERMISSIONS) {
    console.log(`INFO: GRANT_ASSET_PERMISSIONS is enabled for Universe ID: ${MAIN_GAME_UNIVERSE_ID}.`);
}


// --- Gradio Client ---
let gradioClient;
try {
  gradioClient = await Client.connect("http://127.0.0.1:5555/");
  console.log("Successfully connected to Gradio client.");
} catch (error) {
  console.error("Failed to connect to Gradio client. Please ensure it's running and accessible.", error);
  process.exit(1); // Essential service
}

// --- Globals ---
let globalcsrf = ""; // For Roblox API calls
let robloxCookie = ""; // Store cookie globally after first read

// --- Helper Functions ---
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function readAndSetRobloxCookie() {
  try {
    if (fs.existsSync(COOKIE_FILE_PATH)) {
      const cookieValue = fs.readFileSync(COOKIE_FILE_PATH, 'utf-8').trim();
      if (cookieValue) {
        robloxCookie = cookieValue;
        console.log(`Successfully read and set Roblox cookie from ${COOKIE_FILE_PATH}`);
        return true;
      } else {
        console.warn(`Warning: ${COOKIE_FILE_PATH} is empty. Roblox API calls will likely fail.`);
        robloxCookie = "";
        return false;
      }
    } else {
      console.warn(`Warning: ${COOKIE_FILE_PATH} not found. Roblox API calls will likely fail.`);
      robloxCookie = "";
      return false;
    }
  } catch (error) {
    console.error(`Error reading cookie from ${COOKIE_FILE_PATH}:`, error.message);
    robloxCookie = "";
    return false;
  }
}

async function fetchAuthenticatedUserId() {
    if (!robloxCookie) {
        console.error("Cannot fetch authenticated user ID: Roblox cookie not available.");
        return null;
    }
    try {
        console.log("Fetching authenticated user ID...");
        const response = await axios.get("https://users.roblox.com/v1/users/authenticated", {
            headers: {
                Cookie: robloxCookie,
                Accept: 'application/json',
                 // No CSRF needed for this endpoint usually, but good practice if it starts requiring it
                'x-csrf-token': globalcsrf || undefined 
            }
        });
        if (response.data && response.data.id) {
            authenticatedUserID = response.data.id;
            console.log(`Authenticated User ID: ${authenticatedUserID}, Name: ${response.data.name}`);
            return authenticatedUserID;
        } else {
            console.error("Failed to get user ID from authenticated user response:", response.data);
            return null;
        }
    } catch (error) {
        console.error("Error fetching authenticated user ID:", error.response ? error.response.data : error.message);
        if (error.response && error.response.status === 401) {
            console.error("Cookie is invalid or expired. Please update cookies.txt.");
        }
        // Handle CSRF for this endpoint if it starts returning 403 with x-csrf-token
        if (error.response && error.response.status === 403 && error.response.headers['x-csrf-token']) {
            globalcsrf = error.response.headers['x-csrf-token'];
            console.log("CSRF token received while fetching user ID. Retrying...");
            return await fetchAuthenticatedUserId(); // Retry once
        }
        return null;
    }
}

async function checkUniverseManagePermissions(universeId) {
    if (!robloxCookie) {
        console.error("Cannot check universe permissions: Roblox cookie not available.");
        return false;
    }
    try {
        const url = `https://develop.roblox.com/v1/universes/multiget/permissions?ids=${universeId}`;
        console.log(`Checking manage permissions for Universe ID: ${universeId}`);
        const response = await axios.get(url, {
            headers: {
                Cookie: robloxCookie,
                Accept: 'application/json',
                'x-csrf-token': globalcsrf || undefined
            }
        });
        if (response.data && response.data.data && response.data.data[0]) {
            const canManage = response.data.data[0].canManage;
            console.log(`Universe ${universeId} canManage: ${canManage}`);
            return canManage;
        } else {
            console.warn(`Could not determine manage permissions for Universe ${universeId}. Response:`, response.data);
            return false;
        }
    } catch (error) {
        console.error(`Error checking universe manage permissions for ${universeId}:`, error.response ? error.response.data : error.message);
         if (error.response && error.response.status === 403 && error.response.headers['x-csrf-token']) {
            globalcsrf = error.response.headers['x-csrf-token'];
            console.log("CSRF token received while checking universe permissions. Retrying...");
            return await checkUniverseManagePermissions(universeId); // Retry once
        }
        return false;
    }
}

async function grantAssetPermissionsToUniverse(assetId, universeId) {
    if (!robloxCookie) {
        console.error("Cannot grant asset permissions: Roblox cookie not available.");
        return false;
    }
    if (!globalcsrf) {
        console.warn("Cannot grant asset permissions: CSRF token not available. Attempting to fetch one if needed by first making a benign POST or relying on previous errors.");
        // A robust way would be to make a HEAD request to a known endpoint that returns CSRF.
        // For now, we rely on globalcsrf being set by previous errors or hope the PATCH doesn't need it initially.
    }

    try {
        const canManage = await checkUniverseManagePermissions(universeId);
        if (!canManage) {
            console.warn(`User does not have manage permissions for Universe ${universeId}. Cannot grant asset permissions.`);
            return false;
        }

        const url = `https://apis.roblox.com/asset-permissions-api/v1/assets/${assetId}/permissions`;
        const payload = {
            requests: [{ subjectType: "Universe", subjectId: universeId.toString(), action: "Use" }],
            grantToDependencies: false,
            enableDeepAccessCheck: false
        };
        console.log(`Attempting to grant asset ${assetId} 'Use' permission to Universe ${universeId}...`);
        
        await axios.patch(url, payload, {
            headers: {
                'Cookie': robloxCookie,
                'x-csrf-token': globalcsrf, // Crucial for PATCH
                'Content-Type': 'application/json-patch+json', // As per your curl
                'Accept': 'application/json, text/plain, */*', // Adjusted from '*/
                'Origin': 'https://create.roblox.com',
                'Referer': 'https://create.roblox.com/',
            }
        })
        console.log(`Successfully granted asset ${assetId} permissions to Universe ${universeId}.`);
        return true;
    } catch (error) {
        if (error.response) {
            console.error(`Error granting asset permissions for asset ${assetId} to Universe ${universeId}. Status: ${error.response.status}`, error.response.data ? JSON.stringify(error.response.data) : error.response.statusText);
            if (error.response.status === 403 && error.response.headers['x-csrf-token']) {
                globalcsrf = error.response.headers['x-csrf-token'];
                console.log("CSRF token received while granting asset permissions. Retrying...");
                return await grantAssetPermissionsToUniverse(assetId, universeId); // Retry once
            }
        } else {
            console.error(`Error granting asset permissions (no response) for asset ${assetId} to Universe ${universeId}:`, error.message);
        }
        return false;
    }
}


async function getAssetRevisionDetails(operationId) {
  if (!operationId) {
    console.error("getAssetRevisionDetails: operationId is required.");
    return null;
  }
  if (!robloxCookie) {
    console.error("getAssetRevisionDetails: Roblox cookie not available.");
    return null;
  }

  const url = `https://apis.roblox.com/assets/user-auth/v1/operations/${operationId}`;
  console.debug(`[API Call] Fetching asset revision from: ${url}`);

  try {
    const response = await axios.get(url, {
      headers: {
        'Cookie': robloxCookie,
        'x-csrf-token': globalcsrf || undefined,
        'Accept': 'application/json',
        "Origin": "https://create.roblox.com",
        "Referer": "https://create.roblox.com/",
      }
    });

    console.debug("[API Response] getAssetRevisionDetails data:", JSON.stringify(response.data, null, 2));

    if (response.data && response.data.done) {
      return response.data.response ?? null;
    } else if (response.data && !response.data.done) {
      console.debug(`Asset operation ${operationId} is still processing (not 'done').`);
      return null;
    } else {
      console.warn(`Unexpected response structure from getAssetRevisionDetails for ${operationId}:`, response.data);
      return null;
    }
  } catch (error) {
    if (error.response) {
      console.error(`Failed to get asset revision for ${operationId}. Status: ${error.response.status}`, error.response.data ? JSON.stringify(error.response.data) : error.response.statusText);
      if (error.response.status === 403 && error.response.headers['x-csrf-token']) {
        globalcsrf = error.response.headers['x-csrf-token'];
        console.log("CSRF token updated during getAssetRevision. Will use for next attempt.");
      }
    } else {
      console.error(`Error in getAssetRevisionDetails for ${operationId}:`, error.message);
    }
    return null;
  }
}

app.all("/tts", async (req, res) => {
  console.log("Received /tts request with query:", req.query);
  const { text,  char = "JP_Shiroko" } = req.query;
  
  if (!text) {
    return res.status(400).send({ error: "no text?" });
  }
  if (!authenticatedUserID) {
      await fetchAuthenticatedUserId();
      if (!authenticatedUserID) {
          return res.status(500).send({error: "Failed to authenticate Roblox user. Check cookie and server logs."});
      }
  }

  let translatedText;
  try {
    const bingResponse = await MET.translate(text, null, "ja");
    translatedText = bingResponse[0]?.translations[0]?.text;
    if (!translatedText) throw new Error("Bing translation returned no text.");
    console.log(`Translated "${text}" to "${translatedText}"`);
  } catch (error) {
    console.error("Error during translation:", error.message);
    return res.status(500).send({ error: "Translation service error" });
  }

  let gradioResult;
  try {
    gradioResult = await gradioClient.predict("/tts_fn", {
      text: translatedText,
      speaker: char,
      speed: 1,
    });
    if (!gradioResult?.data?.[1]?.url) throw new Error("Gradio response missing audio URL.");
    console.log("Gradio prediction result structure:", gradioResult.data);
  } catch (error) {
    console.error("Error during Gradio client prediction:", error.message);
    return res.status(500).send({ error: "Gradio service error" });
  }
  
  const audioUrlFromGradio = gradioResult.data[1].url;
  console.log("Audio URL from Gradio:", audioUrlFromGradio);

  const uploadResult = await uploadAudioToRoblox(audioUrlFromGradio, text); 

  if (uploadResult && uploadResult.success && uploadResult.id) {
        console.log(`Successfully processed asset for Roblox. ID: ${uploadResult.id}, Status: ${uploadResult.statusNote}`);
        return res.send({ 
          message: "Successfully processed asset for Roblox.",
          robloxAssetUrl: `https://www.roblox.com/library/${uploadResult.id}`,
          assetId: uploadResult.id,
          operationId: uploadResult.operationId,
          statusNote: uploadResult.statusNote
        });
  } else {
    console.error("Failed to upload/process for Roblox:", uploadResult?.error);
    return res.status(500).send({ error: uploadResult?.error || "Failed to upload/process for Roblox.", operationId: uploadResult?.operationId });
  }
});

async function uploadAudioToRoblox(audioUrl, originalText = "TTS Audio") {
  if (!audioUrl) {
    return { error: "No audioUrl provided for upload", id: null };
  }

  let audioFileResponse;
  try {
    audioFileResponse = await axios.get(audioUrl, { responseType: "arraybuffer" });
  } catch (e) {
    return { error: `Failed to download audio from ${audioUrl}: ${e.message}`, id: null };
  }

  const fileBuffer = Buffer.from(audioFileResponse.data);
  if (fileBuffer.length === 0) return { error: "Downloaded audio file is empty.", id: null };

  const detectedContentType = audioFileResponse.headers['content-type'] || 'audio/wav';
  let fileExtension = '.wav';
  if (detectedContentType.includes('mpeg')) fileExtension = '.mp3';
  else if (detectedContentType.includes('ogg')) fileExtension = '.ogg';
  
  const filename = `tts_audio_${Date.now()}${fileExtension}`;
  const assetDisplayName = originalText.substring(0, 47) + (originalText.length > 47 ? "..." : "");
  
  return await doRobloxUploadRequest(fileBuffer, filename, detectedContentType, assetDisplayName);
}

async function doRobloxUploadRequest(fileBuffer, filename, fileContentType, assetDisplayName) {
  if (!robloxCookie) return { error: "Roblox cookie not available for upload.", id: null };
  if (!authenticatedUserID) return { error: "Authenticated User ID not available for upload.", id: null};


  return new Promise((resolve) => {
    const form = new FormData();
    form.append("FileContent", fileBuffer, { filename, contentType: fileContentType });
    form.append("request", JSON.stringify({
        displayName: assetDisplayName,
        description: "Audio created via automated TTS service",
        assetType: "Audio",
        creationContext: { creator: { userId: authenticatedUserID }, expectedPrice: 0 },
      })
    );

    axios.post("https://apis.roblox.com/assets/user-auth/v1/assets", form, {
        headers: {
          ...form.getHeaders(),
          "x-csrf-token": globalcsrf,
          "Cookie": robloxCookie,
          "Accept": "application/json",
          "Origin": "https://create.roblox.com",
          "Referer": "https://create.roblox.com/",
        },
      })
      .then(async apiResponse => {
        const operationId = apiResponse.data.operationId || (apiResponse.data.path ? apiResponse.data.path.split('/').pop() : null);
        if (!operationId) {
            return resolve({ error: 'Upload to Roblox initiated but no operationId received.', id: null });
        }
        console.log(`Upload initiated. OperationId: ${operationId}.`);
        
        let assetDataFromOperation;
        const maxDonePollingAttempts = 25; // Wait up to ~50s for done:true
        const donePollingIntervalMs = 2 * 1000;

        for (let i = 0; i < maxDonePollingAttempts; i++) {
            console.log(`Polling for operation completion (Attempt ${i + 1}/${maxDonePollingAttempts}) for op ${operationId}...`);
            const currentOpStatus = await getAssetRevisionDetails(operationId);
            if (currentOpStatus?.assetId) {
                assetDataFromOperation = currentOpStatus;
                console.log(`Op ${operationId} is done. AssetId: ${assetDataFromOperation.assetId}.`);
                break; 
            } else if (currentOpStatus) { // Done but no assetId?
                 console.warn(`Op ${operationId} 'done' but assetId missing. Data:`, JSON.stringify(currentOpStatus));
            }
            if (i < maxDonePollingAttempts - 1) await sleep(donePollingIntervalMs);
        }

        if (!assetDataFromOperation?.assetId) {
            return resolve({ error: 'Failed to obtain assetId from Roblox operation.', id: null, operationId });
        }
        
        let currentAssetId = parseInt(assetDataFromOperation.assetId.toString(), 10);
        let moderationState = assetDataFromOperation.moderationResult?.moderationState;
        console.log(`Asset ${currentAssetId} (Op ${operationId}) - Initial Moderation State: ${moderationState}`);

        // Grant permissions if enabled, regardless of initial moderation state (as long as assetId exists)
        if (GRANT_ASSET_PERMISSIONS && MAIN_GAME_UNIVERSE_ID) {
            await grantAssetPermissionsToUniverse(currentAssetId, MAIN_GAME_UNIVERSE_ID);
        }

        if (moderationState === 'Approved') {
            return resolve({ success: true, id: currentAssetId, operationId, statusNote: "Asset Approved." });
        }
        if (moderationState === 'Rejected' || moderationState === 'Failed') {
            return resolve({ error: `Asset ${moderationState}`, id: currentAssetId, operationId, statusNote: `Asset ${moderationState}.` });
        }

        if (BYPASS_MODERATION_WAIT && moderationState === 'Reviewing') {
            return resolve({ 
                success: true, id: currentAssetId, operationId, 
                statusNote: "Asset is 'Reviewing'. Moderation wait bypassed." 
            });
        }
        
        if (moderationState === 'Reviewing' || (moderationState !== 'Approved' && moderationState !== 'Rejected' && moderationState !== 'Failed')) {
            console.log(`Asset ${currentAssetId} is '${moderationState}'. Polling for final moderation...`);
            const maxModerationPollingAttempts = 70; // ~5-6 mins
            const moderationPollingIntervalMs = 5 * 1000; 
            let finalModerationData = assetDataFromOperation;

            for (let i = 0; i < maxModerationPollingAttempts; i++) {
                console.log(`Polling moderation (Attempt ${i + 1}/${maxModerationPollingAttempts}) for asset ${currentAssetId}...`);
                const updatedOpStatus = await getAssetRevisionDetails(operationId);

                if (updatedOpStatus?.assetId === assetDataFromOperation.assetId) {
                    finalModerationData = updatedOpStatus;
                    moderationState = finalModerationData.moderationResult?.moderationState;
                    console.log(`Asset ${currentAssetId} - Current Moderation: ${moderationState}`);
                    if (['Approved', 'Rejected', 'Failed'].includes(moderationState)) break; 
                } else if (updatedOpStatus && updatedOpStatus.assetId !== assetDataFromOperation.assetId) {
                     return resolve({ error: `Polling inconsistency op ${operationId}.`, id: null, operationId});
                }
                if (i < maxModerationPollingAttempts - 1) await sleep(moderationPollingIntervalMs);
            }
            
            moderationState = finalModerationData.moderationResult?.moderationState;
            if (moderationState !== 'Approved') {
                return resolve({ error: `Asset not approved. Final Status: ${moderationState || 'Unknown'}`, id: currentAssetId, operationId, statusNote: `Asset moderation: ${moderationState || 'Unknown'}` });
            }
        }
        
        resolve({ success: true, id: currentAssetId, operationId, statusNote: "Asset Approved." });
      })
      .catch(async (error) => {
        let newCsrf, errorMessage, isRateLimitExhausted = false;
        if (error.response) {
          console.error("Roblox POST error - Status:", error.response.status, "Data:", JSON.stringify(error.response.data, null, 2));
          newCsrf = error.response.headers['x-csrf-token'];
          errorMessage = error.response.data?.errors?.[0]?.message || error.response.statusText || "Unknown Roblox API error on POST";
           isRateLimitExhausted = (error.response.data?.code?.includes("RESOURCE_EXHAUSTED"));

          if (error.response.status === 403 && newCsrf) {
            globalcsrf = newCsrf;
            console.log("CSRF on POST. Retrying...");
            return doRobloxUploadRequest(fileBuffer, filename, fileContentType, assetDisplayName).then(resolve);
          }
          if (isRateLimitExhausted) {
            return resolve({ error: `Upload limit reached (RESOURCE_EXHAUSTED).`, id: null });
          }
          if (error.response.status === 429) { // General rate limit
            console.warn("Rate limited on POST. Waiting 10s...");
            await sleep(10 * 1000);
            return doRobloxUploadRequest(fileBuffer, filename, fileContentType, assetDisplayName).then(resolve);
          }
        } else {
          errorMessage = `Axios request setup issue on POST: ${error.message}`;
          console.error(errorMessage, error.request ? "No response received." : "");
        }
        resolve({ error: errorMessage, id: null });
      });
  });
}

async function initializeApp() {
    if (!readAndSetRobloxCookie()) {
        console.error("Failed to read Roblox cookie. Application might not function correctly.");
        // Optionally, you might want to prevent the server from starting or retry.
    }
    await fetchAuthenticatedUserId(); // Fetch user ID at startup

    app.listen(PORT, () => {
      console.log(`TTS to Roblox uploader server listening on port ${PORT}`);
      if (!robloxCookie) console.warn("Roblox cookie is not set. Uploads will fail.");
      if (!authenticatedUserID) console.warn("Authenticated User ID not fetched. Uploads will fail.");
      if (BYPASS_MODERATION_WAIT) console.warn("BYPASS_MODERATION_WAIT is enabled.");
      if (GRANT_ASSET_PERMISSIONS) console.log(`Asset permissions will be granted to Universe ID: ${MAIN_GAME_UNIVERSE_ID}.`);
    });
}

initializeApp();