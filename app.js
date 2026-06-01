const personInput = document.querySelector("#personInput");
const clothInput = document.querySelector("#clothInput");
const downloadButton = document.querySelector("#downloadButton");
const statusText = document.querySelector("#statusText");
const personStepStatus = document.querySelector("#personStepStatus");
const clothStepStatus = document.querySelector("#clothStepStatus");
const tryonCanvas = document.querySelector("#tryonCanvas");
const resultImage = document.querySelector("#resultImage");
const resultTile = document.querySelector("#resultTile");
const resultTileTitle = document.querySelector("#resultTileTitle");
const resultTileStatus = document.querySelector("#resultTileStatus");
const countdownOverlay = document.querySelector("#countdownOverlay");
const countdownText = document.querySelector("#countdownText");
const lightbox = document.querySelector("#lightbox");
const lightboxImg = document.querySelector("#lightboxImg");
const lightboxClose = document.querySelector("#lightboxClose");

let generationToken = 0;
let generationTimer = null;
let lastGeneratedPairKey = "";
let isGenerating = false;

const generator = window.TryOnGenerator.create({
  canvas: tryonCanvas,
  resultImage,
  resultTile,
  resultTitle: resultTileTitle,
  resultStatus: resultTileStatus,
  downloadButton,
});

function createPairKey(state) {
  if (!state.personDataUrl || !state.clothDataUrl) return "";
  return [
    state.personFileName,
    state.personDataUrl.length,
    state.personDataUrl.slice(0, 96),
    state.personDataUrl.slice(-96),
    state.clothFileName,
    state.clothDataUrl.length,
    state.clothDataUrl.slice(0, 96),
    state.clothDataUrl.slice(-96),
  ].join("|");
}

function hasLatestResult(state) {
  const currentPairKey = createPairKey(state);
  return !!(currentPairKey && currentPairKey === lastGeneratedPairKey && generator.getCurrentImageUrl());
}

function updateResultActionState(state = uploads.getState()) {
  const ready = uploads.isReady();
  const latest = hasLatestResult(state);
  resultTile.classList.toggle("can-generate", ready && !latest && !isGenerating);
  resultTile.classList.toggle("can-preview", latest && !isGenerating);
  resultTile.classList.toggle("is-busy", isGenerating);

  if (!ready) {
    resultTileTitle.textContent = "生成区";
    resultTileStatus.textContent = "请先上传人物和衣服照片";
    return;
  }

  if (isGenerating) {
    resultTileTitle.textContent = "生成中";
    resultTileStatus.textContent = "AI 正在生成试穿图";
    return;
  }

  if (!latest) {
    resultTileTitle.textContent = "等待生成";
    resultTileStatus.textContent = "点击生成区开始生成试穿图";
  }
}

const uploads = window.UploadModule.create({
  personInput,
  clothInput,
  personStatus: personStepStatus,
  clothStatus: clothStepStatus,
  onStatus(message) {
    statusText.textContent = message;
  },
  onChange(state) {
    const ready = uploads.isReady();
    if (isGenerating) {
      generationToken += 1;
      clearGenerationTimer();
      hideCountdown();
      isGenerating = false;
    }

    lastGeneratedPairKey = "";
    generator.waitForGeneration(ready);

    if (ready) {
      statusText.textContent = "照片已就绪，点击生成区开始试衣";
    } else {
      statusText.textContent = "等待上传照片";
    }

    updateResultActionState(state);
  },
});

function showCountdown() {
  countdownOverlay.classList.add("is-active");
  countdownText.textContent = "0s";
}

function hideCountdown() {
  countdownOverlay.classList.remove("is-active");
  countdownText.textContent = "";
}

function clearGenerationTimer() {
  if (generationTimer) {
    clearInterval(generationTimer);
    generationTimer = null;
  }
}

function openLightbox() {
  const url = generator.getCurrentImageUrl();
  if (!url) return;
  lightboxImg.src = url;
  lightbox.classList.add("is-open");
}

function closeLightbox() {
  lightbox.classList.remove("is-open");
}

async function generateTryOnImage() {
  const state = uploads.getState();
  if (!state.personDataUrl || !state.clothDataUrl || isGenerating) return;

  if (hasLatestResult(state)) {
    openLightbox();
    return;
  }

  const currentPairKey = createPairKey(state);
  const currentToken = ++generationToken;
  clearGenerationTimer();
  hideCountdown();

  const startTime = Date.now();
  isGenerating = true;
  downloadButton.disabled = true;
  updateResultActionState(state);
  showCountdown();

  generationTimer = setInterval(() => {
    if (currentToken !== generationToken) {
      clearGenerationTimer();
      return;
    }
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    countdownText.textContent = `${elapsed}s`;
    statusText.textContent = `AI 正在生成试穿图... (${elapsed}s)`;
  }, 1000);

  try {
    statusText.textContent = "AI 正在生成试穿图...";
    const response = await fetch((window.API_BASE_URL || "") + "/api/tryon", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personImage: state.personDataUrl,
        clothImage: state.clothDataUrl,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "生成失败");
    }

    if (currentToken !== generationToken) {
      clearGenerationTimer();
      hideCountdown();
      return;
    }

    await generator.renderImageUrl(payload.image);
    lastGeneratedPairKey = currentPairKey;
    clearGenerationTimer();
    hideCountdown();
    isGenerating = false;

    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    statusText.textContent = `AI 试穿图已生成（耗时 ${elapsed}s）`;
    updateResultActionState(uploads.getState());
  } catch (error) {
    clearGenerationTimer();
    hideCountdown();
    if (currentToken !== generationToken) return;

    isGenerating = false;
    generator.waitForGeneration(uploads.isReady());
    statusText.textContent = `AI 生成失败：${error.message}`;
    updateResultActionState(uploads.getState());
  }
}

resultTile.addEventListener("click", () => {
  const state = uploads.getState();
  if (!uploads.isReady()) {
    statusText.textContent = "请先上传人物和衣服照片";
    updateResultActionState(state);
    return;
  }

  if (hasLatestResult(state)) {
    openLightbox();
    return;
  }

  generateTryOnImage();
});

lightboxClose.addEventListener("click", closeLightbox);
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox) closeLightbox();
});

downloadButton.addEventListener("click", () => {
  generator.download();
});

(function loadPromoImages() {
  const promos = [
    { el: ".tile-a", url: "/promo-tile-a.jpg" },
    { el: ".tile-b", url: "/promo-tile-b.jpg" },
    { el: ".tile-c", url: "/promo-tile-c.jpg" },
  ];
  promos.forEach(({ el, url }) => {
    const tile = document.querySelector(el);
    if (!tile) return;
    const img = new Image();
    img.onload = () => {
      tile.style.backgroundImage = `url(${url})`;
      tile.classList.add("is-loaded");
    };
    img.src = url;
  });
})();
