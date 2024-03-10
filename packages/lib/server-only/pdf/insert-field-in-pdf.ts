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

  let dynamicPageWidth = pageWidth;
  let dynamicPageHeight = pageHeight;

  const rotationAngle = page.getRotation();

  const isLandscape = rotationAngle.angle === 90 || rotationAngle.angle === 270;

  if (isLandscape) {
    dynamicPageWidth = pageHeight;
    dynamicPageHeight = pageWidth;
  }

  const fieldWidth = dynamicPageWidth * (Number(field.width) / 100);
  const fieldHeight = dynamicPageHeight * (Number(field.height) / 100);

  const fieldX = dynamicPageWidth * (Number(field.positionX) / 100);
  const fieldY = dynamicPageHeight * (Number(field.positionY) / 100);

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

    // Adjust imageY for bottom-left origin of PDFs
    imageY = dynamicPageHeight - imageY - imageHeight;

    if (isLandscape) {
      imageX = dynamicPageWidth - imageX - imageWidth;
    }

    // Consoles for dev - remove before merge
    console.log({ isLandscape });
    console.log({ dynamicPageWidth, dynamicPageHeight });
    console.log({ fieldX, fieldY });
    console.log({ imageX, imageY });

    page.drawImage(image, {
      x: imageX,
      y: imageY,
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
