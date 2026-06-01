(function () {
  function createTryOnGenerator(options) {
    const ctx = options.canvas.getContext("2d");
    let currentImageUrl = null;

    function clearCanvas() {
      ctx.clearRect(0, 0, options.canvas.width, options.canvas.height);
      currentImageUrl = null;
      if (options.resultImage) {
        options.resultImage.removeAttribute("src");
      }
      options.resultTile?.classList.remove("is-generated");
      options.downloadButton.disabled = true;
    }

    function setResultState(title, status) {
      if (options.resultTitle) options.resultTitle.textContent = title;
      if (options.resultStatus) options.resultStatus.textContent = status;
    }

    function waitForGeneration(isReady) {
      clearCanvas();
      if (isReady) {
        setResultState("等待生成", "点击生成区开始生成试穿图");
      } else {
        setResultState("生成区", "请先上传人物和衣服照片");
      }
    }

    function renderImageUrl(imageUrl) {
      return new Promise((resolve, reject) => {
        const image = new Image();

        image.onload = () => {
          options.canvas.width = image.naturalWidth || image.width;
          options.canvas.height = image.naturalHeight || image.height;
          ctx.clearRect(0, 0, options.canvas.width, options.canvas.height);
          ctx.drawImage(image, 0, 0, options.canvas.width, options.canvas.height);

          currentImageUrl = imageUrl;
          if (options.resultImage) {
            options.resultImage.src = imageUrl;
          }
          options.resultTile?.classList.add("is-generated");
          options.downloadButton.disabled = false;
          resolve();
        };
        image.onerror = () => reject(new Error("生成图读取失败"));
        image.src = imageUrl;
      });
    }

    function download() {
      if (!currentImageUrl) return;

      const link = document.createElement("a");
      link.download = "云试衣间-试穿图.png";
      link.href = options.canvas.toDataURL("image/png");
      link.click();
    }

    waitForGeneration(false);

    return {
      waitForGeneration,
      renderImageUrl,
      download,
      getCurrentImageUrl: () => currentImageUrl,
    };
  }

  window.TryOnGenerator = {
    create: createTryOnGenerator,
  };
})();
