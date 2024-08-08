async function delayedCheckForLinks(
  previousCount,
  retries,
  delay,
  checkGeneratorLinks = false
) {
  for (let i = 0; i < retries; i++) {
    try {
      const invoiceLinks = document.querySelectorAll(
        'a[href*="/ads/manage/invoices_generator/"]'
      );
      if (invoiceLinks.length > 0) {
        console.log("Found invoices generator link, stopping retries");
        await checkForLinks();
        return;
      }

      if (checkGeneratorLinks) {
        throw new Error("No invoices generator links found");
      }

      const currentCount = document.querySelectorAll(
        'a[href*="/ads/manage/billing_transaction/"]'
      ).length;
      console.log(`Current billing transaction links count: ${currentCount}`);

      if (currentCount > previousCount) {
        console.log("Found new billing transaction links, checking for links");
        await checkForLinks();
        return;
      } else {
        throw new Error(
          "No new billing transaction or invoices generator links found"
        );
      }
    } catch (error) {
      console.log(`Retrying... (${i + 1}/${retries})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  console.error(
    "Failed to find new billing transaction or invoices generator links after retries"
  );
}

async function checkForLinks() {
  let foundAnchor = false;
  document.querySelectorAll("a").forEach((anchor) => {
    if (anchor.href.includes("/ads/manage/billing_transaction/")) {
      foundAnchor = true;
      console.log("Anchor matches the PDF condition:", anchor.href);
      processAnchor(anchor);
    } else if (anchor.href.includes("/ads/manage/invoices_generator/")) {
      foundAnchor = true;
      console.log("Anchor matches the zip condition:", anchor.href);
      anchor.addEventListener("click", async function (event) {
        event.preventDefault();

        const zipUrl = anchor.href;
        console.log("Fetching ZIP from URL:", zipUrl);
        const response = await fetch(zipUrl).catch((err) => {
          console.error("Error fetching ZIP:", err);
        });

        if (!response) {
          console.error("No response from fetch");
          return;
        }

        const zipBytes = await response.arrayBuffer().catch((err) => {
          console.error("Error reading ZIP bytes:", err);
        });

        if (!zipBytes) {
          console.error("No ZIP bytes fetched");
          return;
        }

        await processZip(zipBytes);
      });
    }
  });

  if (!foundAnchor) {
    throw new Error("No anchor found with the specified condition");
  }
}

function retry(fn, retries, delay) {
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        await fn();
        resolve();
      } catch (error) {
        if (retries === 0) {
          reject(error);
        } else {
          setTimeout(() => {
            retry(fn, retries - 1, delay)
              .then(resolve)
              .catch(reject);
          }, delay);
        }
      }
    };
    attempt();
  });
}

async function processPdf(pdfBytes, fileName) {
  const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes).catch((err) => {
    console.error("Error loading PDF document:", err);
  });
  if (!pdfDoc) {
    console.error("Failed to load PDF document");
    return null;
  }

  const pages = pdfDoc.getPages();
  console.log("Number of pages in PDF:", pages.length);
  const firstPage = pages[0];
  const lastPage = pages[pages.length - 1];

  const textToRemove = "Receipt for Jamal Wittmer";
  const textToAdd = "Receipt for Godgroup LLC";
  console.log("Replacing text:", textToRemove, "with:", textToAdd);

  // Extract the date from the file name
  const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
  let yPosition = 785; // Default position
  if (dateMatch && dateMatch[1]) {
    const fileDate = new Date(dateMatch[1]);
    const cutoffDate = new Date("2022-04-01");
    if (fileDate >= cutoffDate) {
      yPosition = 755;
    }
  }
  console.log("Y position based on date:", yPosition);

  const textPosition = { x: 50, y: yPosition, width: 200, height: 20 };

  firstPage.drawRectangle({
    x: textPosition.x,
    y: textPosition.y,
    width: textPosition.width,
    height: textPosition.height,
    color: PDFLib.rgb(1, 1, 1),
  });
  console.log("Drew rectangle at position:", textPosition);

  const helvetica = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  firstPage.drawText(textToAdd, {
    x: textPosition.x,
    y: textPosition.y,
    size: 11,
    font: helvetica,
    color: PDFLib.rgb(29 / 255, 33 / 255, 41 / 255),
  });
  console.log("Drew text at position:", textPosition);

  // Footer content
  const footerFont = await pdfDoc.embedFont(PDFLib.StandardFonts.Helvetica);
  const footerFontSize = 7;
  const footerColor = PDFLib.rgb(144 / 255, 148 / 255, 165 / 255);

  const footerLines = [
    "God Group Company Limited",
    "Bac Ninh 222000",
    "Viet Nam",
    "Tax ID: 2301141907",
  ];

  if (dateMatch && dateMatch[1]) {
    const fileYear = new Date(dateMatch[1]).getFullYear();
    if (fileYear <= 2021) {
      footerLines.splice(
        1,
        0,
        "No. 226 Nguyen Dang Dao, Dai Phuc Ward, Bac Ninh City"
      );
    } else {
      footerLines.splice(
        1,
        0,
        "2nd Floor, Viet Long Complex Building, No. 30 Ly Thai To, Ninh Xa Ward, Bac Ninh City"
      );
    }
  }

  // Calculate the height of the background rectangle
  const backgroundHeight = footerLines.length * 10;
  const yOffset = 40;

  // Draw background rectangle on the last page
  const pageWidth = lastPage.getWidth();
  const maxTextWidth = Math.max(
    ...footerLines.map((line) =>
      footerFont.widthOfTextAtSize(line, footerFontSize)
    )
  );
  const backgroundWidth = maxTextWidth + 10; // Add some padding

  lastPage.drawRectangle({
    x: pageWidth - backgroundWidth - 50,
    y: yOffset,
    width: backgroundWidth,
    height: backgroundHeight,
    color: PDFLib.rgb(1, 1, 1),
  });

  // Draw each footer line right-aligned on the last page
  footerLines.reverse().forEach((line, index) => {
    const textWidth = footerFont.widthOfTextAtSize(line, footerFontSize);
    lastPage.drawText(line, {
      x: pageWidth - textWidth - 55, // Adjust x position for right alignment with padding
      y: yOffset + index * 10,
      size: footerFontSize,
      font: footerFont,
      color: footerColor,
    });
  });

  const modifiedPdfBytes = await pdfDoc.save().catch((err) => {
    console.error("Error saving PDF document:", err);
  });
  if (!modifiedPdfBytes) {
    console.error("Failed to save PDF document");
    return null;
  }

  return modifiedPdfBytes;
}

async function processAnchor(anchor) {
  console.log("Processing anchor:", anchor.href);
  anchor.addEventListener("click", async function (event) {
    event.preventDefault();

    const pdfUrl = anchor.href;
    console.log("Fetching PDF from URL:", pdfUrl);
    const response = await fetch(pdfUrl).catch((err) => {
      console.error("Error fetching PDF:", err);
    });

    if (!response) {
      console.error("No response from fetch");
      return;
    }

    const existingPdfBytes = await response.arrayBuffer().catch((err) => {
      console.error("Error reading PDF bytes:", err);
    });

    if (!existingPdfBytes) {
      console.error("No PDF bytes fetched");
      return;
    }

    // Get the file name from the Content-Disposition header
    const contentDisposition = response.headers.get("Content-Disposition");
    let fileName = "modified-file.pdf";
    if (contentDisposition && contentDisposition.includes("filename=")) {
      const match = contentDisposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) {
        fileName = match[1];
      }
    }
    console.log("File name extracted from header:", fileName);

    const modifiedPdfBytes = await processPdf(existingPdfBytes, fileName);
    if (!modifiedPdfBytes) {
      console.error("Failed to modify PDF document");
      return;
    }

    const blob = new Blob([modifiedPdfBytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    console.log("Created object URL for PDF blob:", url);

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log("Download initiated and URL revoked");
  });
}

async function processZip(zipBytes) {
  const zip = await JSZip.loadAsync(zipBytes);
  const modifiedZip = new JSZip();

  for (const fileName in zip.files) {
    if (zip.files[fileName].name.endsWith(".pdf")) {
      const pdfBytes = await zip.files[fileName].async("arraybuffer");
      const modifiedPdfBytes = await processPdf(pdfBytes, fileName);
      if (modifiedPdfBytes) {
        modifiedZip.file(fileName, modifiedPdfBytes);
      }
    }
  }

  const modifiedZipBytes = await modifiedZip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(modifiedZipBytes);
  const a = document.createElement("a");
  a.href = url;
  a.download = "transaction-files.zip";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  console.log("Download of modified zip initiated and URL revoked");
}

function startExtension() {
  console.log("Extension started");

  document.addEventListener("click", function (event) {
    const button = event.target.closest('div[role="button"][tabindex="0"]');
    if (!button) return;

    const buttonText = button.textContent.trim();

    if (buttonText === "See more") {
      console.log("See More button clicked, checking for new links...");
      const currentCount = document.querySelectorAll(
        'a[href*="/ads/manage/billing_transaction/"]'
      ).length;
      retry(
        async () => {
          await delayedCheckForLinks(currentCount, 20, 5000);
        },
        1,
        3000
      ).catch((error) => {
        console.error("Failed to find new links after See More:", error);
      });
    } else if (buttonText === "Download") {
      console.log(
        "Download button clicked, checking for invoices generator links..."
      );
      retry(
        async () => {
          await delayedCheckForLinks(0, 20, 5000, true);
        },
        1,
        3000
      ).catch((error) => {
        console.error(
          "Failed to find invoices generator links after Download:",
          error
        );
      });
    }

    const resetButton = button.closest(
      'div[role="button"][tabindex="0"].x1e56ztr'
    );
    if (resetButton) {
      console.log("Reset button clicked, resetting currentCount...");
      retry(
        async () => {
          await delayedCheckForLinks(0, 20, 5000);
        },
        1,
        3000
      ).catch((error) => {
        console.error(
          "Failed to find new links after resetting currentCount:",
          error
        );
      });
    }
  });

  delayedCheckForLinks(0, 20, 5000)
    .then(() => {
      console.log("Initial check for links completed");
    })
    .catch((error) => {
      console.error("Failed initial check for links:", error);
    });
}

// Make sure PDFLib and JSZip are loaded before calling startExtension
if (typeof PDFLib !== "undefined" && typeof JSZip !== "undefined") {
  startExtension();
} else {
  console.error("PDFLib or JSZip is not loaded");
}
