var isRecording = false;
var steps = [];
var isProcessingClick = false;
var isProcessingPress = false;

function sendMessageWithRetry(message, callback, maxRetries = 3, delay = 1000) {
  let retries = 0;

  function attemptSend() {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error("Error sending message:", chrome.runtime.lastError);
        if (retries < maxRetries) {
          retries++;
          setTimeout(attemptSend, delay);
        } else {
          console.error("Max retries reached. Message failed.");
          callback({ error: "Max retries reached" });
        }
      } else {
        callback(response);
      }
    });
  }

  attemptSend();
}

function initializeContentScript() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Received message:", message);
    switch (message.action) {
      case "initState":
        isRecording = message.isRecording;
        steps = message.steps;
        sendResponse({ success: true });
        break;
      case "startRecording":
        isRecording = true;
        sendMessageWithRetry({ action: "setRecordingState", isRecording: true }, (response) => {
          sendResponse({ status: response.error ? "Failed to start recording" : "Recording started" });
        });
        return true;
      case "stopRecording":
        isRecording = false;
        sendMessageWithRetry({ action: "setRecordingState", isRecording: false }, (response) => {
          sendResponse({ status: response.error ? "Failed to stop recording" : "Recording stopped" });
        });
        return true;
      case "getRecordingStatus":
        sendMessageWithRetry({ action: "getState" }, (response) => {
          if (response.error) {
            sendResponse({ error: "Failed to get recording status" });
          } else {
            sendResponse({ isRecording: response.isRecording, steps: response.steps });
          }
        });
        return true;
      case "updateSteps":
        steps = message.steps;
        isRecording = message.isRecording;
        sendResponse({ success: true });
        break;
      default:
        console.warn("Unknown message action:", message.action);
        sendResponse({ error: "Unknown action" });
    }
  });

  document.addEventListener("click", handleClick, true);
  console.log("Click listener added");
  document.addEventListener("keypress", handleKeypress, true);
  console.log("Keypress listener added");
  setupIframeListeners();
  console.log("Iframe listeners set up");
}

function setupIframeListeners() {
  document.addEventListener('click', handleIframeInteraction, true);
  document.addEventListener('focus', handleIframeInteraction, true);
  document.addEventListener('keypress', handleIframeInteraction, true);
}

function handleIframeInteraction(event) {
  if (!isRecording || isProcessingClick || isProcessingPress) return;

  const iframe = event.target.closest('iframe');
  if (iframe) {
    isProcessingClick = true;
    const iframeRect = iframe.getBoundingClientRect();
    const step = {
      type: 'iframeInteraction',
      timestamp: new Date().toISOString(),
      url: window.location.href,
      iframeSource: iframe.src,
      interactionType: event.type,
      x: event.clientX,
      y: event.clientY,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      iframePosition: {
        x: iframeRect.x,
        y: iframeRect.y,
        width: iframeRect.width,
        height: iframeRect.height
      }
    };

    sendMessageWithRetry({ action: "addStep", step: step }, (response) => {
      console.log("Iframe interaction step added:", response);
    });

    setTimeout(() => {
      sendMessageWithRetry({ action: "captureVisibleTab" }, (response) => {
        if (response.error) {
          console.error("Error capturing screenshot for iframe interaction:", response.error);
        } else {
          step.screenshot = response.dataUrl;
          sendMessageWithRetry({ action: "updateStep", step: step }, (updateResponse) => {
            console.log("Iframe interaction step updated with screenshot:", updateResponse);
            isProcessingClick = false;
          });
        }
      });
    }, 500);
  }
}

async function handleClick(event) {
  console.log("Click event detected");
  console.log("isRecording:", isRecording);
  console.log("isProcessingClick:", isProcessingClick);
  
  if (!event.isTrusted || !isRecording || isProcessingClick || event.clientX === undefined || event.clientY === undefined) {
    console.log("Skipping this event.");
    return;
  }
  
  console.log("Processing click");
  isProcessingClick = true;

  // Add a "welcome" step if this is the first step
  if (steps.length === 0) {
    const welcomeStep = {
      type: 'welcome',
      timestamp: new Date().toISOString(),
      message: 'Welcome to the recording session!',
      url: window.location.href
    };

    await new Promise((resolve, reject) => {
      sendMessageWithRetry({ action: "addStep", step: welcomeStep }, (response) => {
        console.log("Welcome step added:", response);
        if (response.error) {
          console.error("Error adding welcome step:", response.error);
          reject(response.error);
        } else {
          resolve();
        }
      });
    });
  }

  const isLink = event.target && (event.target.tagName === 'A' || event.target.closest('a'));
  let targetHref = '';
  if (isLink) {
    event.preventDefault();
    const linkElement = event.target.tagName === 'A' ? event.target : event.target.closest('a');
    targetHref = linkElement ? linkElement.href : '';
  }

  const step = {
    type: 'click',
    x: event.clientX,
    y: event.clientY,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    pageX: event.pageX,
    pageY: event.pageY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    timestamp: new Date().toISOString(),
    url: window.location.href,
    target: event.target ? {
      tagName: event.target.tagName || '',
      id: event.target.id || '',
      className: event.target.className || '',
      innerText: event.target.innerText || '',
      href: targetHref
    } : {}
  };

  console.log("Step details:", step);

  document.body.style.pointerEvents = 'none';

  try {
    await new Promise((resolve, reject) => {
      sendMessageWithRetry({ 
        action: "captureVisibleTab"
      }, (response) => {
        console.log("Capture response:", response);
        if (response.error) {
          console.error("Error capturing screenshot:", response.error);
          reject(response.error);
        } else if (!response.dataUrl) {
          console.error("Screenshot capture failed: No dataUrl received");
          reject(new Error("No screenshot data received"));
        } else {
          step.screenshot = response.dataUrl;
          console.log("Screenshot captured successfully");
          resolve();
        }
      });
    });

    await new Promise((resolve, reject) => {
      sendMessageWithRetry({ action: "addStep", step: step }, (addStepResponse) => {
        console.log("Add step response:", addStepResponse);
        if (addStepResponse.error) {
          console.error("Error adding step:", addStepResponse.error);
          reject(addStepResponse.error);
        } else {
          steps.push(step); // Add step to the list
          console.log("Step added successfully with screenshot");
          resolve();
        }
      });
    });

  } catch (error) {
    console.error("Error processing click or capturing screenshot:", error);
  } finally {
    document.body.style.pointerEvents = '';
    isProcessingClick = false;
    if (isLink && targetHref) {
      window.location.href = targetHref;
    }
  }
}

async function handleKeypress(event) {
  console.log("Keypress event detected");
  console.log("isRecording:", isRecording);
  console.log("isProcessingPress:", isProcessingPress);
  
  if (!event.isTrusted || !isRecording) {
    console.log("Skipping this event.");
    return;
  }
  
  console.log("Processing Keypress");
  isProcessingPress = true;

  const isLink = event.target && (event.target.tagName === 'A' || event.target.closest('a'));
  let targetHref = '';
  if (isLink) {
    event.preventDefault();
    const linkElement = event.target.tagName === 'A' ? event.target : event.target.closest('a');
    targetHref = linkElement ? linkElement.href : '';
  }

  const step = {
    type: 'keypress',
    x: event.clientX,
    y: event.clientY,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    pageX: event.pageX,
    pageY: event.pageY,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    timestamp: new Date().toISOString(),
    url: window.location.href,
    target: event.target ? {
      tagName: event.target.tagName || '',
      id: event.target.id || '',
      className: event.target.className || '',
      innerText: event.code || '',
      href: targetHref
    } : {}
  };

  console.log("Step details:", step);

  document.body.style.pointerEvents = 'none';

  try {
    await new Promise((resolve, reject) => {
      sendMessageWithRetry({ 
        action: "captureVisibleTab"
      }, (response) => {
        console.log("Capture response:", response);
        if (response.error) {
          console.error("Error capturing screenshot:", response.error);
          reject(response.error);
        } else if (!response.dataUrl) {
          console.error("Screenshot capture failed: No dataUrl received");
          reject(new Error("No screenshot data received"));
        } else {
          step.screenshot = response.dataUrl;
          console.log("Screenshot captured successfully");
          resolve();
        }
      });
    });

    await new Promise((resolve, reject) => {
      sendMessageWithRetry({ action: "addStep", step: step }, (addStepResponse) => {
        console.log("Add step response:", addStepResponse);
        if (addStepResponse.error) {
          console.error("Error adding step:", addStepResponse.error);
          reject(addStepResponse.error);
        } else {
          console.log("Step added successfully with screenshot");
          resolve();
        }
      });
    });

  } catch (error) {
    console.error("Error processing click or capturing screenshot:", error);
  } finally {
    document.body.style.pointerEvents = '';
    isProcessingPress = false;
    if (isLink && targetHref) {
      window.location.href = targetHref;
    }
  }
}

initializeContentScript();