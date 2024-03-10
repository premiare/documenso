// https://github.com/Hopding/pdf-lib/issues/20#issuecomment-412852821
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import {
  DEFAULT_HANDWRITING_FONT_SIZE,
  DEFAULT_STANDARD_FONT_SIZE,
  MIN_HANDWRITING_FONT_SIZE,
  MIN_STANDARD_FONT_SIZE,
} from '@documenso/lib/constants/pdf';
import { FieldType } from '@documenso/prisma/client';
import { isSignatureFieldType } from '@documenso/prisma/guards/is-signature-field';
import type { FieldWithSignature } from '@documenso/prisma/types/field-with-signature';

export const insertFieldInPDF = async (pdf: PDFDocument, field: FieldWithSignature) => {
  const fontCaveat = await fetch(process.env.FONT_CAVEAT_URI).then(async (res) =>
    res.arrayBuffer(),
  );

  const isSignatureField = isSignatureFieldType(field.type);

  pdf.registerFontkit(fontkit);

  const pages = pdf.getPages();

  const minFontSize = isSignatureField ? MIN_HANDWRITING_FONT_SIZE : MIN_STANDARD_FONT_SIZE;
  const maxFontSize = isSignatureField ? DEFAULT_HANDWRITING_FONT_SIZE : DEFAULT_STANDARD_FONT_SIZE;
  let fontSize = maxFontSize;

  const page = pages.at(field.page - 1);

  if (!page) {
    throw new Error(`Page ${field.page} does not exist`);
  }

  const { width: pageWidth, height: pageHeight } = page.getSize();

  let dyanmicPageWidth = pageWidth;
  let dynamicPageHeight = pageHeight;

  const rotationAngle = page.getRotation();

  const isLandscape = rotationAngle.angle === 90 || rotationAngle.angle === 270;

  if (isLandscape) {
    dyanmicPageWidth = pageHeight;
    dynamicPageHeight = pageWidth;
  }

  const fieldWidth = dyanmicPageWidth * (Number(field.width) / 100);
  const fieldHeight = dynamicPageHeight * (Number(field.height) / 100);

  const fieldX = dyanmicPageWidth * (Number(field.positionX) / 100);
  const fieldY = dynamicPageHeight * (Number(field.positionY) / 100);
  console.log({ isLandscape, dyanmicPageWidth, dynamicPageHeight, fieldX, fieldY });
  const font = await pdf.embedFont(isSignatureField ? fontCaveat : StandardFonts.Helvetica);

  if (field.type === FieldType.SIGNATURE || field.type === FieldType.FREE_SIGNATURE) {
    await pdf.embedFont(fontCaveat);
  }

  const isInsertingImage =
    isSignatureField && typeof field.Signature?.signatureImageAsBase64 === 'string';

  if (isSignatureField && isInsertingImage) {
    const image = await pdf.embedPng(field.Signature?.signatureImageAsBase64 ?? '');

    let imageWidth = image.width;
    let imageHeight = image.height;

    const scalingFactor = Math.min(fieldWidth / imageWidth, fieldHeight / imageHeight, 1);

    imageWidth = imageWidth * scalingFactor;
    imageHeight = imageHeight * scalingFactor;

    let imageX = fieldX + (fieldWidth - imageWidth) / 2;
    let imageY = fieldY + (fieldHeight - imageHeight) / 2;

    if (isLandscape) {
      if (rotationAngle.angle === 90) {
        // For 90 degrees, the image's bottom-left corner shifts. You might need to adjust like so:
        imageX = fieldX + (fieldWidth + imageHeight) / 2; // Adjust based on image height because it's rotated
        imageY = dynamicPageHeight - fieldY - (fieldHeight + imageWidth) / 2;
      } else if (rotationAngle.angle === 270) {
        // For 270 degrees, a similar adjustment, but considering the rotation's effect:
        imageX = fieldX - (fieldWidth - imageHeight) / 2; // Adjust based on the image height because it's rotated
        imageY = fieldY - (fieldHeight - imageWidth) / 2;
      }
      // Adjust imageY for bottom-left origin of PDFs
      imageY = dynamicPageHeight - imageY - imageHeight;
    } else {
      // Your existing logic here for non-rotated or 180 degrees rotated cases
      imageY = dynamicPageHeight - imageY - imageHeight;
    }

    page.drawImage(image, {
      x: 300,
      y: 250,
      width: imageWidth,
      height: imageHeight,
      rotate: rotationAngle,
    });
  } else {
    const longestLineInTextForWidth = field.customText
      .split('\n')
      .sort((a, b) => b.length - a.length)[0];

    let textWidth = font.widthOfTextAtSize(longestLineInTextForWidth, fontSize);
    const textHeight = font.heightAtSize(fontSize);

    const scalingFactor = Math.min(fieldWidth / textWidth, fieldHeight / textHeight, 1);

    fontSize = Math.max(Math.min(fontSize * scalingFactor, maxFontSize), minFontSize);
    textWidth = font.widthOfTextAtSize(longestLineInTextForWidth, fontSize);

    const textX = fieldX + (fieldWidth - textWidth) / 2;
    let textY = fieldY + (fieldHeight - textHeight) / 2;

    // Invert the Y axis since PDFs use a bottom-left coordinate system
    textY = pageHeight - textY - textHeight;

    page.drawText(field.customText, {
      x: textX,
      y: textY,
      size: fontSize,
      font,
      rotate: rotationAngle,
    });
  }

  return pdf;
};

export const insertFieldInPDFBytes = async (
  pdf: ArrayBuffer | Uint8Array | string,
  field: FieldWithSignature,
) => {
  const pdfDoc = await PDFDocument.load(pdf);

  await insertFieldInPDF(pdfDoc, field);

  return await pdfDoc.save();
};
