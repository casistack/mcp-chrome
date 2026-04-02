/**
 * Screenshot Configuration and Parameter Normalization
 *
 * Handles the complexity of legacy parameter support while providing
 * a clean, unified interface for screenshot operations.
 *
 * Addresses token limit issues by providing smart defaults and
 * accurate size estimation capabilities.
 */

export interface NormalizedScreenshotParams {
  // Core behavior
  saveMode: 'base64' | 'file' | 'auto';
  fileFormat: 'jpeg' | 'png' | 'webp';
  compressionQuality: number; // 0.1-1.0

  // Token management
  targetTokenBudget: number;
  maxInlineSize: number;

  // Output options
  includeThumbnail: boolean;
  includeAbsolutePath: boolean;
  saveFolder: string;

  // Capture params (pass-through)
  name?: string;
  selector?: string;
  width?: number;
  height?: number;
  fullPage?: boolean;
  maxHeight?: number;

  // Metadata
  compatWarnings: string[];
}

export interface ScreenshotDefaults {
  saveMode: 'auto';
  fileFormat: 'webp';
  compressionQuality: 0.85;
  targetTokenBudget: 18000; // Conservative under 25K limit
  maxInlineSize: 20000;
  includeThumbnail: false;
  includeAbsolutePath: false;
  saveFolder: 'MCP-Screenshots';
  retentionMaxCount: 50;
  retentionMaxDays: 7;
}

export interface ScreenshotConfig extends ScreenshotDefaults {
  // User preferences stored in chrome.storage
  contentAwareFormat: boolean;
  autoCleanup: boolean;
  showNotifications: boolean;
}

/**
 * Configuration manager for screenshot settings with user preference support
 */
export class ScreenshotConfigManager {
  private static instance: ScreenshotConfigManager;
  private config: ScreenshotConfig | null = null;

  static getInstance(): ScreenshotConfigManager {
    if (!ScreenshotConfigManager.instance) {
      ScreenshotConfigManager.instance = new ScreenshotConfigManager();
    }
    return ScreenshotConfigManager.instance;
  }

  private getDefaults(): ScreenshotDefaults {
    return {
      saveMode: 'auto',
      fileFormat: 'webp',
      compressionQuality: 0.85,
      targetTokenBudget: 18000,
      maxInlineSize: 20000,
      includeThumbnail: false,
      includeAbsolutePath: false,
      saveFolder: 'MCP-Screenshots',
      retentionMaxCount: 50,
      retentionMaxDays: 7,
    };
  }

  /**
   * Load configuration from chrome.storage with fallback to defaults
   */
  async loadConfig(): Promise<ScreenshotConfig> {
    if (this.config) return this.config;

    const defaults = this.getDefaults();

    try {
      // Load user preferences from chrome.storage.local (not sync due to size)
      const stored = await chrome.storage.local.get('screenshotConfig');
      const userConfig = stored.screenshotConfig || {};

      this.config = {
        ...defaults,
        ...userConfig,
        // Extended config with safe defaults
        contentAwareFormat: userConfig.contentAwareFormat ?? true,
        autoCleanup: userConfig.autoCleanup ?? true,
        showNotifications: userConfig.showNotifications ?? false,
      } as ScreenshotConfig;
    } catch (error) {
      console.warn('Failed to load screenshot config, using defaults:', error);
      this.config = {
        ...defaults,
        contentAwareFormat: true,
        autoCleanup: true,
        showNotifications: false,
      } as ScreenshotConfig;
    }

    return this.config;
  }

  /**
   * Save updated configuration to chrome.storage
   */
  async saveConfig(updates: Partial<ScreenshotConfig>): Promise<void> {
    const currentConfig = await this.loadConfig();
    const newConfig = { ...currentConfig, ...updates };

    try {
      await chrome.storage.local.set({ screenshotConfig: newConfig });
      this.config = newConfig;
    } catch (error) {
      console.error('Failed to save screenshot config:', error);
      throw error;
    }
  }

  /**
   * Normalize legacy and new parameters into unified config
   *
   * This is the core function that handles backward compatibility
   * while providing clear migration path to new parameter system.
   */
  normalizeParams(input: any): NormalizedScreenshotParams {
    const compatWarnings: string[] = [];

    // Start with current config as base
    const config = this.config || this.getDefaults();

    // Determine save mode from various parameter combinations
    let saveMode: 'base64' | 'file' | 'auto' = config.saveMode;

    // Legacy parameter mapping with deprecation warnings
    if (input.storeBase64 === true) {
      saveMode = 'base64';
      compatWarnings.push(
        'Parameter "storeBase64" is deprecated. Use "saveMode: \'base64\'" instead.',
      );
    }

    if (input.savePng === true) {
      saveMode = 'file';
      compatWarnings.push(
        'Parameter "savePng" is deprecated. Use "saveMode: \'file\'" with "fileFormat: \'png\'" instead.',
      );
    }

    // New parameters take precedence over legacy
    if (input.saveMode) {
      saveMode = input.saveMode;
    }

    if (input.returnPath === true) {
      saveMode = 'file';
    }

    // File format determination with legacy support
    let fileFormat: 'jpeg' | 'png' | 'webp' = config.fileFormat;

    if (input.savePng === true) {
      fileFormat = 'png';
    }

    if (input.fileFormat) {
      fileFormat = input.fileFormat;
    }

    // If base64 mode, prefer JPEG for size unless explicitly overridden
    if (saveMode === 'base64' && !input.fileFormat && !input.savePng) {
      fileFormat = 'jpeg';
    }

    // Validate and constrain numeric parameters
    const compressionQuality = Math.min(
      Math.max(input.compressionQuality ?? config.compressionQuality, 0.1),
      1.0,
    );

    const targetTokenBudget = input.targetTokenBudget ?? config.targetTokenBudget;
    const maxInlineSize = input.maxInlineSize ?? config.maxInlineSize;

    return {
      // Normalized behavior
      saveMode,
      fileFormat,
      compressionQuality,
      targetTokenBudget,
      maxInlineSize,

      // Output options
      includeThumbnail: input.includeThumbnail ?? config.includeThumbnail,
      includeAbsolutePath: input.includeAbsolutePath ?? config.includeAbsolutePath,
      saveFolder: input.saveFolder ?? config.saveFolder,

      // Pass-through capture parameters
      name: input.name,
      selector: input.selector,
      width: input.width,
      height: input.height,
      fullPage: input.fullPage,
      maxHeight: input.maxHeight,

      // Metadata
      compatWarnings,
    };
  }

  /**
   * Validate parameter combinations and provide helpful error messages
   */
  validateParams(params: NormalizedScreenshotParams): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate save mode
    if (!['base64', 'file', 'auto'].includes(params.saveMode)) {
      errors.push('saveMode must be "base64", "file", or "auto"');
    }

    // Validate file format
    if (!['jpeg', 'png', 'webp'].includes(params.fileFormat)) {
      errors.push('fileFormat must be "jpeg", "png", or "webp"');
    }

    // Validate compression quality
    if (params.compressionQuality < 0.1 || params.compressionQuality > 1.0) {
      errors.push('compressionQuality must be between 0.1 and 1.0');
    }

    // Validate token budget
    if (params.targetTokenBudget < 1000 || params.targetTokenBudget > 24000) {
      errors.push('targetTokenBudget should be between 1000 and 24000 tokens');
    }

    // Validate dimensions if provided
    if (params.width && (params.width < 1 || params.width > 7680)) {
      errors.push('width must be between 1 and 7680 pixels');
    }

    if (params.height && (params.height < 1 || params.height > 4320)) {
      errors.push('height must be between 1 and 4320 pixels');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}

/**
 * Utility functions for parameter handling and size estimation
 */

/**
 * Enhanced token estimation system with accurate size calculation
 */

/**
 * Estimate token count from base64 string length
 * Based on empirical analysis: base64 chars ≈ 0.29 tokens + JSON overhead
 */
export function estimateTokens(base64Length: number): number {
  // Conservative estimation with safety margin
  return Math.ceil(base64Length * 0.29) + 200;
}

/**
 * Estimate final token count including JSON response structure
 * Accounts for MCP response format overhead
 */
export function estimateResponseTokens(base64Length: number, additionalData?: object): number {
  const baseTokens = estimateTokens(base64Length);

  // Account for MCP response structure overhead
  const responseStructureOverhead = 150; // ToolResult format, content array, etc.

  // Account for additional metadata if provided
  let metadataOverhead = 0;
  if (additionalData) {
    const metadataString = JSON.stringify(additionalData);
    metadataOverhead = Math.ceil(metadataString.length * 0.3);
  }

  return baseTokens + responseStructureOverhead + metadataOverhead;
}

/**
 * Calculate base64 length from image dimensions and format
 * Provides size estimation before actual compression
 */
export function estimateBase64Size(
  width: number,
  height: number,
  format: 'jpeg' | 'png' | 'webp',
  quality: number = 0.8,
): number {
  const pixelCount = width * height;

  // Bytes per pixel estimates based on format and quality
  let bytesPerPixel: number;

  switch (format) {
    case 'jpeg':
      // JPEG: Variable compression, quality-dependent
      bytesPerPixel = 0.5 + quality * 2.5; // Range: 0.5-3.0 bytes/pixel
      break;
    case 'png':
      // PNG: Lossless, depends on complexity (assume moderate complexity)
      bytesPerPixel = 2.5; // Average for UI screenshots
      break;
    case 'webp':
      // WebP: Better compression than JPEG
      bytesPerPixel = 0.4 + quality * 2.0; // Range: 0.4-2.4 bytes/pixel
      break;
  }

  const estimatedBytes = pixelCount * bytesPerPixel;

  // Base64 encoding increases size by ~33%
  const base64Bytes = estimatedBytes * 1.33;

  return Math.ceil(base64Bytes);
}

/**
 * Check if screenshot will fit within token budget
 * Returns detailed analysis with recommendations
 */
export function analyzeTokenBudget(params: {
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
  quality: number;
  targetTokenBudget: number;
  maxInlineSize: number;
}): {
  estimatedTokens: number;
  willFit: boolean;
  exceedsBy: number;
  recommendation: 'inline' | 'file' | 'compress_more' | 'reduce_quality';
  suggestions: string[];
} {
  const estimatedBase64Size = estimateBase64Size(
    params.width,
    params.height,
    params.format,
    params.quality,
  );

  const estimatedTokens = estimateResponseTokens(estimatedBase64Size);
  const willFit = estimatedTokens <= params.targetTokenBudget;
  const exceedsBy = Math.max(0, estimatedTokens - params.targetTokenBudget);

  const suggestions: string[] = [];
  let recommendation: 'inline' | 'file' | 'compress_more' | 'reduce_quality';

  if (willFit) {
    recommendation = 'inline';
  } else if (exceedsBy > params.targetTokenBudget * 0.5) {
    // Significantly over budget - file mode recommended
    recommendation = 'file';
    suggestions.push('Screenshot is too large for inline delivery. Use file mode.');
  } else if (params.quality > 0.7) {
    // Moderate overage - try lower quality
    recommendation = 'reduce_quality';
    suggestions.push(
      `Reduce quality to ${Math.max(0.5, params.quality - 0.2).toFixed(1)} to fit token budget`,
    );
  } else {
    // Close to budget - try more compression
    recommendation = 'compress_more';
    suggestions.push('Try WebP format or smaller dimensions for better compression');
  }

  if (params.format === 'png' && estimatedTokens > params.targetTokenBudget * 0.8) {
    suggestions.push('PNG format creates large files. Consider JPEG or WebP for screenshots.');
  }

  if (params.width > 1920 || params.height > 1080) {
    suggestions.push('Large dimensions detected. Consider scaling down for inline delivery.');
  }

  return {
    estimatedTokens,
    willFit,
    exceedsBy,
    recommendation,
    suggestions,
  };
}

/**
 * Calculate compression ratio achieved
 */
export function calculateCompressionRatio(originalSize: number, compressedSize: number): number {
  if (originalSize === 0) return 0;
  return (originalSize - compressedSize) / originalSize;
}

/**
 * Validate token budget parameters
 */
export function validateTokenBudget(
  targetTokenBudget: number,
  maxInlineSize: number,
): { isValid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (targetTokenBudget > 24000) {
    warnings.push('Token budget exceeds safe MCP limit (24,000). Consider lower value.');
  }

  if (targetTokenBudget < 5000) {
    warnings.push(
      'Token budget very low. May prevent most screenshots from being delivered inline.',
    );
  }

  if (maxInlineSize > targetTokenBudget * 4) {
    warnings.push('Max inline size too high for token budget. Adjust ratio.');
  }

  return {
    isValid: warnings.length === 0,
    warnings,
  };
}

/**
 * Generate unique screenshot ID for tracking and deduplication
 */
export function generateScreenshotId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `screenshot_${timestamp}_${random}`;
}

/**
 * Format file size for human-readable display
 */
export function formatFilesize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Enhanced content-aware format detection with comprehensive analysis
 */

export interface FormatAnalysisResult {
  recommended: 'jpeg' | 'png' | 'webp';
  confidence: number; // 0-1
  reasoning: string;
  characteristics: {
    hasTransparency: boolean;
    colorDiversity: number; // 0-1
    averageVariance: number; // 0-255
    edgeComplexity: number; // 0-1
    textContent: number; // 0-1 (estimated)
    photoContent: number; // 0-1 (estimated)
  };
  alternatives: Array<{
    format: 'jpeg' | 'png' | 'webp';
    suitability: number; // 0-1
    reason: string;
  }>;
}

/**
 * Content-aware format detection with detailed analysis
 */
export async function suggestFormat(imageDataUrl: string): Promise<'jpeg' | 'png' | 'webp'> {
  const analysis = await analyzeImageForFormat(imageDataUrl);
  return analysis.recommended;
}

/**
 * Comprehensive image analysis for format selection
 */
export async function analyzeImageForFormat(imageDataUrl: string): Promise<FormatAnalysisResult> {
  try {
    // Use fetch and createImageBitmap for service worker compatibility
    const response = await fetch(imageDataUrl);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    // Use larger sample for better analysis
    const sampleSize = Math.min(200, Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(sampleSize, sampleSize);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      bitmap.close();
      return getDefaultAnalysis('Analysis failed: no canvas context');
    }

    // Draw scaled version for analysis
    ctx.drawImage(bitmap, 0, 0, sampleSize, sampleSize);
    const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);

    // Analyze image characteristics
    const characteristics = analyzeImageCharacteristics(imageData);

    // Determine optimal format based on characteristics
    const formatSuitability = calculateFormatSuitability(characteristics);

    // Select best format
    const bestFormat = Object.entries(formatSuitability).sort(
      ([, a], [, b]) => b.score - a.score,
    )[0];

    const alternatives = Object.entries(formatSuitability)
      .filter(([format]) => format !== bestFormat[0])
      .sort(([, a], [, b]) => b.score - a.score)
      .map(([format, data]) => ({
        format: format as 'jpeg' | 'png' | 'webp',
        suitability: data.score,
        reason: data.reason,
      }));

    return {
      recommended: bestFormat[0] as 'jpeg' | 'png' | 'webp',
      confidence: bestFormat[1].score,
      reasoning: bestFormat[1].reason,
      characteristics,
      alternatives,
    };
  } catch (error) {
    console.warn('Format analysis failed:', error);
    return getDefaultAnalysis('Analysis failed due to error');
  }
}

/**
 * Analyze image characteristics for format selection
 */
function analyzeImageCharacteristics(
  imageData: ImageData,
): FormatAnalysisResult['characteristics'] {
  const data = imageData.data;
  const pixelCount = imageData.width * imageData.height;

  const colors = new Set<string>();
  let transparentPixels = 0;
  let semiTransparentPixels = 0;
  let totalVariance = 0;
  let edgePixels = 0;
  let highContrastRegions = 0;
  let lowSaturationPixels = 0;

  // First pass: basic characteristics
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    // Transparency analysis
    if (a === 0) {
      transparentPixels++;
    } else if (a < 255) {
      semiTransparentPixels++;
    }

    // Color diversity
    colors.add(`${r},${g},${b}`);

    // Variance calculation
    const gray = (r + g + b) / 3;
    totalVariance += Math.abs(gray - 128);

    // Saturation analysis (for photo vs UI detection)
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max > 0 ? (max - min) / max : 0;

    if (saturation < 0.2) {
      lowSaturationPixels++;
    }
  }

  // Second pass: edge detection (simplified Sobel operator)
  for (let y = 1; y < imageData.height - 1; y++) {
    for (let x = 1; x < imageData.width - 1; x++) {
      const idx = (y * imageData.width + x) * 4;

      // Calculate gradients
      const gx =
        -1 * getGrayValue(data, idx - 4 - imageData.width * 4) +
        1 * getGrayValue(data, idx + 4 - imageData.width * 4) +
        -2 * getGrayValue(data, idx - 4) +
        2 * getGrayValue(data, idx + 4) +
        -1 * getGrayValue(data, idx - 4 + imageData.width * 4) +
        1 * getGrayValue(data, idx + 4 + imageData.width * 4);

      const gy =
        -1 * getGrayValue(data, idx - 4 - imageData.width * 4) +
        -2 * getGrayValue(data, idx - imageData.width * 4) +
        -1 * getGrayValue(data, idx + 4 - imageData.width * 4) +
        1 * getGrayValue(data, idx - 4 + imageData.width * 4) +
        2 * getGrayValue(data, idx + imageData.width * 4) +
        1 * getGrayValue(data, idx + 4 + imageData.width * 4);

      const magnitude = Math.sqrt(gx * gx + gy * gy);

      if (magnitude > 50) {
        // Edge threshold
        edgePixels++;
      }

      if (magnitude > 100) {
        // High contrast threshold
        highContrastRegions++;
      }
    }
  }

  const colorDiversity = colors.size / pixelCount;
  const averageVariance = totalVariance / pixelCount;
  const edgeComplexity = edgePixels / pixelCount;
  const hasTransparency = transparentPixels + semiTransparentPixels > 0;

  // Estimate content type based on characteristics
  const textContent = Math.min(1, (edgeComplexity * 2 + lowSaturationPixels / pixelCount) / 2);
  const photoContent = Math.min(1, (colorDiversity * 2 + highContrastRegions / pixelCount) / 2);

  return {
    hasTransparency,
    colorDiversity,
    averageVariance,
    edgeComplexity,
    textContent,
    photoContent,
  };
}

/**
 * Calculate format suitability scores based on image characteristics
 */
function calculateFormatSuitability(
  characteristics: FormatAnalysisResult['characteristics'],
): Record<string, { score: number; reason: string }> {
  const {
    hasTransparency,
    colorDiversity,
    averageVariance,
    edgeComplexity,
    textContent,
    photoContent,
  } = characteristics;

  const formats = {
    png: { score: 0, reason: '' },
    jpeg: { score: 0, reason: '' },
    webp: { score: 0, reason: '' },
  };

  // PNG scoring
  if (hasTransparency) {
    formats.png.score += 0.8; // Strong preference for transparency
    formats.png.reason = 'Required for transparency preservation';
  } else if (textContent > 0.7) {
    formats.png.score += 0.6;
    formats.png.reason = 'Excellent for text and UI elements';
  } else if (colorDiversity < 0.3 && edgeComplexity > 0.3) {
    formats.png.score += 0.5;
    formats.png.reason = 'Good for graphics with sharp edges and limited colors';
  } else {
    formats.png.score += 0.2;
    formats.png.reason = 'Lossless but potentially large file size';
  }

  // JPEG scoring
  if (hasTransparency) {
    formats.jpeg.score = 0; // Cannot handle transparency
    formats.jpeg.reason = 'Cannot handle transparency';
  } else if (photoContent > 0.6) {
    formats.jpeg.score += 0.7;
    formats.jpeg.reason = 'Excellent compression for photographic content';
  } else if (colorDiversity > 0.5 && averageVariance > 50) {
    formats.jpeg.score += 0.6;
    formats.jpeg.reason = 'Good for complex images with many colors';
  } else if (textContent > 0.6) {
    formats.jpeg.score += 0.1; // Poor for text
    formats.jpeg.reason = 'Poor choice for text - may cause artifacts';
  } else {
    formats.jpeg.score += 0.4;
    formats.jpeg.reason = 'Decent compression but may lose quality';
  }

  // WebP scoring (generally good for most content)
  if (hasTransparency) {
    formats.webp.score += 0.7;
    formats.webp.reason = 'Supports transparency with excellent compression';
  } else if (photoContent > 0.5) {
    formats.webp.score += 0.8;
    formats.webp.reason = 'Superior compression for photographic content';
  } else if (textContent > 0.5) {
    formats.webp.score += 0.7;
    formats.webp.reason = 'Excellent for UI/text with lossless mode available';
  } else {
    formats.webp.score += 0.75;
    formats.webp.reason = 'Best overall compression efficiency for mixed content';
  }

  // Boost WebP slightly for modern format preference
  formats.webp.score += 0.1;

  return formats;
}

/**
 * Get grayscale value from RGBA pixel data
 */
function getGrayValue(data: Uint8ClampedArray, index: number): number {
  if (index < 0 || index >= data.length - 2) return 0;
  return (data[index] + data[index + 1] + data[index + 2]) / 3;
}

/**
 * Default analysis result when analysis fails
 */
function getDefaultAnalysis(reason: string): FormatAnalysisResult {
  return {
    recommended: 'webp',
    confidence: 0.5,
    reasoning: `${reason}. Defaulting to WebP as general-purpose format.`,
    characteristics: {
      hasTransparency: false,
      colorDiversity: 0.5,
      averageVariance: 64,
      edgeComplexity: 0.3,
      textContent: 0.5,
      photoContent: 0.5,
    },
    alternatives: [
      { format: 'jpeg', suitability: 0.4, reason: 'Good for photos without transparency' },
      { format: 'png', suitability: 0.3, reason: 'Lossless but larger file size' },
    ],
  };
}

/**
 * Check if a parameter set represents legacy usage
 */
export function isLegacyParameterUsage(input: any): boolean {
  return !!(input.storeBase64 || input.savePng) && !input.saveMode;
}

/**
 * Generate helpful suggestions for parameter optimization
 */
export function generateParameterSuggestions(params: NormalizedScreenshotParams): string[] {
  const suggestions: string[] = [];

  if (params.saveMode === 'base64' && params.targetTokenBudget > 20000) {
    suggestions.push(
      'Consider using "saveMode: \'auto\'" for large screenshots to avoid token limits',
    );
  }

  if (params.fileFormat === 'png' && params.saveMode === 'base64') {
    suggestions.push(
      'PNG format creates larger files. Consider JPEG or WebP for inline screenshots',
    );
  }

  if (params.compressionQuality > 0.9 && params.saveMode === 'base64') {
    suggestions.push(
      'High compression quality may exceed token limits. Consider quality 0.7-0.8 for inline mode',
    );
  }

  if (params.compatWarnings.length > 0) {
    suggestions.push('Update to new parameter format for better control and future compatibility');
  }

  return suggestions;
}
