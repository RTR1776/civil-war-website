#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { fromArrayBuffer } from "geotiff";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const manifestPath = path.join(projectRoot, "public", "data", "franklin", "manifest.json");
const outputPath = path.join(projectRoot, "public", "data", "franklin", "terrain-dem.json");

const gridWidth = 192;
const gridHeight = 192;

function round(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const { west, south, east, north } = manifest.bounds;

  const params = new URLSearchParams({
    bbox: `${west},${south},${east},${north}`,
    bboxSR: "4326",
    imageSR: "4326",
    size: `${gridWidth},${gridHeight}`,
    format: "tiff",
    pixelType: "F32",
    interpolation: "RSP_BilinearInterpolation",
    f: "image",
  });

  const endpoint = `https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage?${params.toString()}`;

  const response = await fetch(endpoint);
  if (!response.ok) {
    throw new Error(`USGS DEM request failed: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const geotiff = await fromArrayBuffer(arrayBuffer);
  const image = await geotiff.getImage();
  const raster = await image.readRasters({ interleave: true });

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const noData = image.getGDALNoData();
  const values = [];

  for (let index = 0; index < raster.length; index += 1) {
    const value = Number(raster[index]);
    const invalid = Number.isNaN(value) || !Number.isFinite(value) || value < -10000 || value === noData;

    if (invalid) {
      values.push(null);
      continue;
    }

    min = Math.min(min, value);
    max = Math.max(max, value);
    values.push(round(value, 2));
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error("DEM raster did not include usable elevation values.");
  }

  const payload = {
    source: "USGS 3DEPElevation ImageServer",
    generatedAt: new Date().toISOString(),
    query: endpoint,
    width: image.getWidth(),
    height: image.getHeight(),
    minElevation: round(min, 2),
    maxElevation: round(max, 2),
    noDataValue: noData,
    bbox: manifest.bounds,
    heights: values,
  };

  await writeFile(outputPath, JSON.stringify(payload));

  console.log(`DEM grid written to ${outputPath}`);
  console.log(`Resolution: ${payload.width}x${payload.height}`);
  console.log(`Elevation range: ${payload.minElevation}m to ${payload.maxElevation}m`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
