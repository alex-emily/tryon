(function () {
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片读取失败"));
      };
      image.src = url;
    });
  }

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
  }

  function resizeImage(image, maxW, maxH) {
    var w = image.naturalWidth || image.width;
    var h = image.naturalHeight || image.height;
    var scale = Math.min(maxW / w, maxH / h, 1);
    if (scale >= 1) {
      return { dataUrl: null, width: w, height: h };
    }

    var canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    var ctx = canvas.getContext("2d");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.85),
      width: canvas.width,
      height: canvas.height,
    };
  }

  function loadAndResize(file) {
    return loadImage(file).then(function (image) {
      var result = resizeImage(image, 800, 1200);
      if (result.dataUrl) {
        return { image: image, dataUrl: result.dataUrl };
      }
      return readDataUrl(file).then(function (dataUrl) {
        return { image: image, dataUrl: dataUrl };
      });
    });
  }

  function createUploadModule(options) {
    const state = {
      person: null,
      cloth: null,
      personDataUrl: "",
      clothDataUrl: "",
      personFileName: "",
      clothFileName: "",
    };

    function getState() {
      return { ...state };
    }

    function isReady() {
      return !!(state.personDataUrl && state.clothDataUrl);
    }

    function updateThumb(kind, dataUrl) {
      const inputId = kind === "person" ? "personInput" : "clothInput";
      const label = document.querySelector(`label[for="${inputId}"]`);
      if (!label) return;

      label.classList.add("has-thumb");
      label.style.backgroundImage = `url(${dataUrl})`;
      const title = label.querySelector(".step-title");
      const status = label.querySelector("small");
      if (title) title.textContent = "";
      if (status) status.textContent = "";
    }

    async function handleUpload(kind, event) {
      const file = event.target.files?.[0];
      if (!file) return;

      options.onStatus?.("正在处理照片...");
      const result = await loadAndResize(file);

      if (kind === "person") {
        state.person = result.image;
        state.personDataUrl = result.dataUrl;
        state.personFileName = file.name;
        options.personStatus.textContent = "已上传";
        options.onStatus?.("人物照片已上传，请继续上传衣服照片");
      } else {
        state.cloth = result.image;
        state.clothDataUrl = result.dataUrl;
        state.clothFileName = file.name;
        options.clothStatus.textContent = "已上传";
        options.onStatus?.("衣服照片已上传");
      }

      updateThumb(kind, result.dataUrl);

      if (isReady()) {
        options.onStatus?.("照片已就绪，点击生成区开始试衣");
      }

      options.onChange?.(getState());
    }

    function reset() {
      state.person = null;
      state.cloth = null;
      state.personDataUrl = "";
      state.clothDataUrl = "";
      state.personFileName = "";
      state.clothFileName = "";
      options.personInput.value = "";
      options.clothInput.value = "";
      options.personStatus.textContent = "点击上传";
      options.clothStatus.textContent = "点击上传";
      options.onStatus?.("等待上传照片");

      ["personInput", "clothInput"].forEach((id) => {
        const label = document.querySelector(`label[for="${id}"]`);
        if (!label) return;
        label.classList.remove("has-thumb");
        label.style.backgroundImage = "";
        const title = label.querySelector(".step-title");
        const status = label.querySelector("small");
        if (title) title.textContent = id === "personInput" ? "人物照片" : "衣服照片";
        if (status) status.textContent = "点击上传";
      });

      options.onChange?.(getState());
    }

    options.personInput.addEventListener("change", (event) => handleUpload("person", event));
    options.clothInput.addEventListener("change", (event) => handleUpload("cloth", event));

    return {
      getState,
      isReady,
      reset,
    };
  }

  window.UploadModule = {
    create: createUploadModule,
  };
})();
