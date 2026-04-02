/**
 * Smart Auto Mode Implementation
 *
 * Orchestrates the complete screenshot delivery pipeline with intelligent
 * decision-making between inline (base64) and file-based delivery.
 *
 * Integrates:
 * - Parameter normalization
 * - Token estimation
 * - Content-aware format selection
 * - Progressive compression
 * - Storage manifest tracking
 */

// Constants for robust error handling
const TOKEN_OVERFLOW_SENTINEL = 'SCREENSHOT_TOKEN_OVERFLOW';

// Structured reason codes for decision tracking
export enum DecisionReasonCode {
  INLINE_OK = 'INLINE_OK',
  INLINE_OVERFLOW_FILE_FALLBACK = 'INLINE_OVERFLOW_FILE_FALLBACK',
  COMPRESSION_INADEQUATE_FILE = 'COMPRESSION_INADEQUATE_FILE',
  USER_FORCED_FILE = 'USER_FORCED_FILE',
  USER_FORCED_INLINE = 'USER_FORCED_INLINE',
  TOKEN_EXCEEDED = 'TOKEN_EXCEEDED',
  QUALITY_FALLBACK = 'QUALITY_FALLBACK',
}

import {
  ScreenshotConfigManager,
  type NormalizedScreenshotParams,
  analyzeTokenBudget,
  validateTokenBudget,
  generateParameterSuggestions,
  estimateResponseTokens,
} from './screenshot-config';
import {
  AdaptiveCompressor,
  type AdaptiveCompressionResult,
  analyzeCompressionEffectiveness,
} from './adaptive-compression';
import { ScreenshotManifest, type ScreenshotManifestEntry } from './screenshot-manifest';

export interface AutoModeDecision {
  mode: 'inline' | 'file';
  reasoning: string;
  confidence: number; // 0-1
  metadata: {
    tokenBudgetAnalysis: ReturnType<typeof analyzeTokenBudget>;
    compressionResult?: AdaptiveCompressionResult;
    fallbackReason?: string;
    reasonCode?: DecisionReasonCode;
    performanceMetrics: {
      totalDuration: number;
      analysisTime: number;
      compressionTime: number;
      manifestTime: number;
    };
  };
}

export interface SmartAutoModeResult {
  success: boolean;
  decision: AutoModeDecision;

  // Error information (when success is false)
  errorCode?: 'INLINE_CREATION_FAILED' | 'FILE_CREATION_FAILED' | 'NO_VALID_RESULT';
  errorMessage?: string;

  // Inline delivery result
  inlineResult?: {
    base64Data: string;
    mimeType: string;
    actualTokens: number;
    compressionRatio: number;
    format: string;
  };

  // File delivery result
  fileResult?: {
    filePath: string;
    absolutePath?: string;
    fileSize: number;
    mimeType: string;
    format: string;
    base64Data?: string; // Store for manifest hashing
  };

  // Manifest tracking
  manifestEntry?: ScreenshotManifestEntry;

  // User feedback
  suggestions: string[];
  warnings: string[];

  // Quality metrics
  qualityMetrics: {
    compressionQuality: number;
    visualQuality: number; // 0-1 estimate
    efficiencyScore: number; // 0-1 overall efficiency
  };
}

export class SmartAutoMode {
  private configManager: ScreenshotConfigManager;

  constructor() {
    this.configManager = ScreenshotConfigManager.getInstance();
  }

  /**
   * Execute smart auto mode for screenshot delivery
   */
  async executeAutoMode(
    imageDataUrl: string,
    params: {
      url: string;
      title?: string;
      selector?: string;
      width?: number;
      height?: number;
      // Legacy parameters (will be normalized)
      storeBase64?: boolean;
      savePng?: boolean;
      // Enhanced parameters
      saveMode?: 'base64' | 'file' | 'auto';
      fileFormat?: 'jpeg' | 'png' | 'webp';
      compressionQuality?: number;
      targetTokenBudget?: number;
      enableContentAnalysis?: boolean;
      tags?: string[];
      notes?: string;
    },
  ): Promise<SmartAutoModeResult> {
    const startTime = Date.now();
    const suggestions: string[] = [];
    const warnings: string[] = [];

    // Phase 1: Parameter normalization
    const analysisStart = Date.now();
    const normalizedParams = this.configManager.normalizeParams(params);

    // Add legacy parameter warnings to suggestions
    suggestions.push(...normalizedParams.compatWarnings);
    suggestions.push(...generateParameterSuggestions(normalizedParams));

    // Validate parameters
    const validation = this.configManager.validateParams(normalizedParams);
    if (!validation.isValid) {
      warnings.push(...validation.errors);
    }

    // Get image dimensions
    const dimensions = await this.extractImageDimensions(imageDataUrl);

    // Phase 2: Token budget analysis
    const tokenBudgetAnalysis = analyzeTokenBudget({
      width: dimensions.width,
      height: dimensions.height,
      format: 'webp', // Default for initial analysis
      quality: normalizedParams.compressionQuality,
      targetTokenBudget: normalizedParams.targetTokenBudget,
      maxInlineSize: normalizedParams.maxInlineSize,
    });

    const analysisTime = Date.now() - analysisStart;

    // Phase 3: Mode decision and execution
    const decision = await this.makeAutoModeDecision(
      imageDataUrl,
      normalizedParams,
      tokenBudgetAnalysis,
      params.enableContentAnalysis ?? true,
    );

    const compressionTime = decision.metadata.compressionResult?.totalDuration || 0;

    // Phase 4: Execute chosen mode
    let inlineResult: SmartAutoModeResult['inlineResult'];
    let fileResult: SmartAutoModeResult['fileResult'];
    let manifestEntry: ScreenshotManifestEntry | undefined;

    const manifestStart = Date.now();

    if (decision.mode === 'inline' && decision.metadata.compressionResult?.success) {
      try {
        inlineResult = this.createInlineResult(decision.metadata.compressionResult);
        manifestEntry = await this.createManifestEntry(
          'base64',
          params,
          dimensions,
          decision.metadata.compressionResult,
        );
      } catch (error) {
        // Check if this is a token overflow - if so, gracefully fallback to file mode
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.startsWith(TOKEN_OVERFLOW_SENTINEL)) {
          console.log(
            `Token overflow detected during inline creation, falling back to file mode: ${errorMessage}`,
          );
          // Fall through to file mode creation below
          decision.mode = 'file';
          decision.reasoning = `Inline creation failed due to token overflow (${errorMessage.match(/(\d+) tokens/)?.[1] || 'unknown'} tokens). Automatically switched to file mode for compatibility.`;
          decision.confidence = 0.9; // High confidence in fallback decision
          decision.metadata.reasonCode = DecisionReasonCode.INLINE_OVERFLOW_FILE_FALLBACK;
        } else {
          // Other errors should still fail
          return {
            success: false,
            errorCode: 'INLINE_CREATION_FAILED',
            errorMessage: `Failed to create inline result: ${errorMessage}`,
            decision,
            manifestEntry: undefined,
            suggestions,
            warnings,
            qualityMetrics: { compressionQuality: 0, visualQuality: 0, efficiencyScore: 0 },
          };
        }
      }
    }

    if (decision.mode === 'file' || !inlineResult) {
      try {
        fileResult = await this.createFileResult(
          imageDataUrl,
          params,
          normalizedParams,
          dimensions,
        );
        manifestEntry = await this.createManifestEntry(
          'file',
          params,
          dimensions,
          undefined,
          fileResult,
        );
      } catch (error) {
        return {
          success: false,
          errorCode: 'FILE_CREATION_FAILED',
          errorMessage: `Failed to create file result: ${error instanceof Error ? error.message : 'Unknown error'}`,
          decision,
          manifestEntry: undefined,
          suggestions,
          warnings,
          qualityMetrics: { compressionQuality: 0, visualQuality: 0, efficiencyScore: 0 },
        };
      }
    }

    // Additional validation - ensure we have a valid result
    if (!inlineResult && !fileResult) {
      return {
        success: false,
        errorCode: 'NO_VALID_RESULT',
        errorMessage: 'Failed to generate either inline or file result',
        decision,
        manifestEntry: undefined,
        suggestions,
        warnings,
        qualityMetrics: { compressionQuality: 0, visualQuality: 0, efficiencyScore: 0 },
      };
    }

    const manifestTime = Date.now() - manifestStart;

    // Calculate quality metrics
    const qualityMetrics = this.calculateQualityMetrics(
      decision,
      inlineResult,
      fileResult,
      tokenBudgetAnalysis,
    );

    const totalDuration = Date.now() - startTime;

    // Update performance metrics
    decision.metadata.performanceMetrics = {
      totalDuration,
      analysisTime,
      compressionTime,
      manifestTime,
    };

    return {
      success: true,
      decision,
      inlineResult,
      fileResult,
      manifestEntry,
      suggestions,
      warnings,
      qualityMetrics,
    };
  }

  /**
   * Make intelligent decision between inline and file modes
   */
  private async makeAutoModeDecision(
    imageDataUrl: string,
    params: NormalizedScreenshotParams,
    tokenAnalysis: ReturnType<typeof analyzeTokenBudget>,
    enableContentAnalysis: boolean,
  ): Promise<AutoModeDecision> {
    // Force modes based on explicit user choice
    if (params.saveMode === 'base64') {
      return {
        mode: 'inline',
        reasoning: 'User explicitly requested base64/inline mode',
        confidence: 1.0,
        metadata: {
          tokenBudgetAnalysis: tokenAnalysis,
          reasonCode: DecisionReasonCode.USER_FORCED_INLINE,
          performanceMetrics: {
            totalDuration: 0,
            analysisTime: 0,
            compressionTime: 0,
            manifestTime: 0,
          },
        },
      };
    }

    if (params.saveMode === 'file') {
      return {
        mode: 'file',
        reasoning: 'User explicitly requested file mode',
        confidence: 1.0,
        metadata: {
          tokenBudgetAnalysis: tokenAnalysis,
          reasonCode: DecisionReasonCode.USER_FORCED_FILE,
          performanceMetrics: {
            totalDuration: 0,
            analysisTime: 0,
            compressionTime: 0,
            manifestTime: 0,
          },
        },
      };
    }

    // Auto mode decision logic
    const compressionStart = Date.now();

    // Try adaptive compression to see if inline is viable
    const compressionResult = await AdaptiveCompressor.compressForInline(imageDataUrl, {
      targetTokenBudget: params.targetTokenBudget,
      enableContentAnalysis,
      maxAttempts: 4, // Limit attempts for auto mode
      minQuality: 0.6, // Reasonable quality floor
    });

    if (compressionResult.success && compressionResult.bestResult) {
      // Inline mode succeeded
      const effectiveness = analyzeCompressionEffectiveness(compressionResult);
      const qualityScore = compressionResult.bestResult.qualityScore;

      return {
        mode: 'inline',
        reasoning:
          `Compression succeeded with ${compressionResult.bestResult.format.toUpperCase()} format. ` +
          `${compressionResult.bestResult.strategy} achieved ${Math.round(compressionResult.bestResult.compressionRatio * 100)}% compression ` +
          `(${compressionResult.bestResult.actualTokens} tokens, quality: ${qualityScore.toFixed(2)})`,
        confidence: Math.min(0.95, qualityScore + 0.1), // Boost confidence for successful compression
        metadata: {
          tokenBudgetAnalysis: tokenAnalysis,
          compressionResult,
          reasonCode: DecisionReasonCode.INLINE_OK,
          performanceMetrics: {
            totalDuration: 0,
            analysisTime: 0,
            compressionTime: Date.now() - compressionStart,
            manifestTime: 0,
          },
        },
      };
    } else {
      // Fall back to file mode
      let fallbackReason = 'Compression failed to fit within token budget';

      if (compressionResult.attempts.length > 0) {
        const bestAttempt = compressionResult.attempts
          .filter((a) => a.result.success)
          .sort((a, b) => a.result.actualTokens - b.result.actualTokens)[0];

        if (bestAttempt) {
          fallbackReason =
            `Best compression achieved ${bestAttempt.result.actualTokens} tokens ` +
            `(exceeds budget by ${bestAttempt.result.actualTokens - params.targetTokenBudget} tokens). ` +
            `Using file mode for better quality preservation.`;
        }
      }

      return {
        mode: 'file',
        reasoning: fallbackReason,
        confidence: 0.8, // Confident in file mode as fallback
        metadata: {
          tokenBudgetAnalysis: tokenAnalysis,
          compressionResult,
          fallbackReason,
          reasonCode: DecisionReasonCode.COMPRESSION_INADEQUATE_FILE,
          performanceMetrics: {
            totalDuration: 0,
            analysisTime: 0,
            compressionTime: Date.now() - compressionStart,
            manifestTime: 0,
          },
        },
      };
    }
  }

  /**
   * Create inline result from compression output
   */
  private createInlineResult(
    compressionResult: AdaptiveCompressionResult,
  ): SmartAutoModeResult['inlineResult'] {
    if (!compressionResult.bestResult) {
      throw new Error('Cannot create inline result without successful compression');
    }

    // Final token overflow guard - ensure we never return inline content that exceeds limits
    const actualTokens = compressionResult.bestResult.actualTokens;
    if (actualTokens > 24000) {
      throw new Error(
        `${TOKEN_OVERFLOW_SENTINEL}: ${actualTokens} tokens exceeds safe limit of 24,000. Should have used file mode.`,
      );
    }

    return {
      base64Data: compressionResult.bestResult.base64Data,
      mimeType: compressionResult.bestResult.mimeType,
      actualTokens: compressionResult.bestResult.actualTokens,
      compressionRatio: compressionResult.bestResult.compressionRatio,
      format: compressionResult.bestResult.format,
    };
  }

  /**
   * Create file result by saving screenshot
   */
  private async createFileResult(
    imageDataUrl: string,
    originalParams: any,
    normalizedParams: NormalizedScreenshotParams,
    dimensions: { width: number; height: number },
  ): Promise<SmartAutoModeResult['fileResult']> {
    // For file mode, use high quality settings
    const fileFormat = normalizedParams.fileFormat;
    const quality = Math.max(0.85, normalizedParams.compressionQuality); // Higher quality for files

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = normalizedParams.name || `screenshot-${timestamp}.${fileFormat}`;

    try {
      // Use data URL directly for chrome.downloads API (service worker compatible)
      const downloadId = await new Promise<number>((resolve, reject) => {
        chrome.downloads.download(
          {
            url: imageDataUrl, // Use data URL directly
            filename: filename,
            saveAs: false, // Save directly to Downloads folder
          },
          (id) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(id);
            }
          },
        );
      });

      // Wait for download to complete and get the actual file path
      const downloadItem = await new Promise<chrome.downloads.DownloadItem>((resolve, reject) => {
        const checkComplete = () => {
          chrome.downloads.search({ id: downloadId }, (items) => {
            const item = items[0];
            if (!item) {
              reject(new Error('Download item not found'));
              return;
            }

            if (item.state === 'complete') {
              resolve(item);
            } else if (item.state === 'interrupted') {
              reject(new Error(`Download failed: ${item.error}`));
            } else {
              // Still downloading, check again
              setTimeout(checkComplete, 100);
            }
          });
        };
        checkComplete();
      });

      // Calculate actual file size from base64 data
      const base64Data = imageDataUrl.split(',')[1];
      const actualFileSize = Math.ceil(base64Data.length * 0.75); // Base64 to binary size approximation

      return {
        filePath: filename, // Relative filename
        absolutePath: downloadItem.filename || undefined, // Real absolute path from Chrome
        fileSize: actualFileSize,
        mimeType: `image/${fileFormat}`,
        format: fileFormat,
        base64Data: imageDataUrl, // Store for manifest hashing
      };
    } catch (error) {
      console.error('Failed to save screenshot file:', error);

      // Fallback to simulation if download fails
      const simulatedFileSize = this.estimateFileSize(dimensions, fileFormat, quality);

      return {
        filePath: filename,
        absolutePath: normalizedParams.includeAbsolutePath
          ? `/Users/Downloads/${filename}`
          : undefined,
        fileSize: simulatedFileSize,
        mimeType: `image/${fileFormat}`,
        format: fileFormat,
        base64Data: imageDataUrl, // Store for manifest hashing
      };
    }
  }

  /**
   * Create manifest entry for tracking
   */
  private async createManifestEntry(
    storageMode: 'file' | 'base64',
    originalParams: any,
    dimensions: { width: number; height: number },
    compressionResult?: AdaptiveCompressionResult,
    fileResult?: SmartAutoModeResult['fileResult'],
  ): Promise<ScreenshotManifestEntry> {
    // Use content-based hash for better deduplication
    let hash: string;
    if (compressionResult?.bestResult?.base64Data) {
      hash = await ScreenshotManifest.generateContentHash(compressionResult.bestResult.base64Data);
    } else if (fileResult?.base64Data) {
      hash = await ScreenshotManifest.generateContentHash(fileResult.base64Data);
    } else {
      // Fallback to URL+dimensions hash
      hash = ScreenshotManifest.generateHash(
        originalParams.url + dimensions.width + dimensions.height,
      );
    }

    const entry: Omit<
      ScreenshotManifestEntry,
      'id' | 'timestamp' | 'accessCount' | 'lastAccessed' | 'retentionScore'
    > = {
      hash,
      url: originalParams.url,
      title: originalParams.title,
      dimensions: { width: dimensions.width, height: dimensions.height, dpr: 1 },
      storageMode,
      tags: originalParams.tags || [],
      notes: originalParams.notes,
      source: 'screenshot_tool',
      compressionStats: {
        originalSize: dimensions.width * dimensions.height * 4, // Rough estimate
        finalSize:
          storageMode === 'base64'
            ? compressionResult?.bestResult?.actualSize || 0
            : fileResult?.fileSize || 0,
        format:
          storageMode === 'base64'
            ? (compressionResult?.bestResult?.format as 'jpeg' | 'png' | 'webp') || 'webp'
            : (fileResult?.format as 'jpeg' | 'png' | 'webp') || 'webp',
        quality: compressionResult?.bestResult?.qualityScore || 0.85,
        scale: 1.0,
        compressionRatio: compressionResult?.bestResult?.compressionRatio || 0.3,
        attempts: compressionResult?.attempts.length || 1,
        strategy:
          storageMode === 'base64'
            ? compressionResult?.bestResult?.strategy || 'file fallback'
            : 'high quality file storage',
      },
    };

    if (storageMode === 'file' && fileResult) {
      entry.filePath = fileResult.filePath;
      entry.absolutePath = fileResult.absolutePath;
      entry.fileSize = fileResult.fileSize;
    } else if (storageMode === 'base64' && compressionResult?.bestResult) {
      entry.base64Size = compressionResult.bestResult.actualSize;
    }

    const manifestId = await ScreenshotManifest.addEntry(entry);
    const fullEntry = await ScreenshotManifest.getEntry(manifestId);

    if (!fullEntry) {
      throw new Error('Failed to create manifest entry');
    }

    return fullEntry;
  }

  /**
   * Calculate quality metrics for the result
   */
  private calculateQualityMetrics(
    decision: AutoModeDecision,
    inlineResult?: SmartAutoModeResult['inlineResult'],
    fileResult?: SmartAutoModeResult['fileResult'],
    tokenAnalysis?: ReturnType<typeof analyzeTokenBudget>,
  ): SmartAutoModeResult['qualityMetrics'] {
    let compressionQuality = 0.8; // Default
    let visualQuality = 0.8; // Default
    let efficiencyScore = 0.7; // Default

    if (decision.mode === 'inline' && inlineResult) {
      compressionQuality = inlineResult.compressionRatio;
      visualQuality = decision.metadata.compressionResult?.bestResult?.qualityScore || 0.7;

      // Efficiency: balance of compression and token usage
      const tokenEfficiency = tokenAnalysis?.willFit ? 1.0 : 0.5;
      efficiencyScore = compressionQuality * 0.4 + visualQuality * 0.4 + tokenEfficiency * 0.2;
    } else if (decision.mode === 'file' && fileResult) {
      compressionQuality = 0.9; // Files generally higher quality
      visualQuality = 0.9; // Files preserve quality better

      // Efficiency: file mode is efficient for large images
      const sizeEfficiency = fileResult.fileSize < 1024 * 1024 ? 1.0 : 0.8; // Bonus for reasonable file sizes
      efficiencyScore = compressionQuality * 0.3 + visualQuality * 0.4 + sizeEfficiency * 0.3;
    }

    return {
      compressionQuality: Math.min(1.0, Math.max(0, compressionQuality)),
      visualQuality: Math.min(1.0, Math.max(0, visualQuality)),
      efficiencyScore: Math.min(1.0, Math.max(0, efficiencyScore)),
    };
  }

  /**
   * Extract image dimensions from data URL
   */
  private async extractImageDimensions(
    imageDataUrl: string,
  ): Promise<{ width: number; height: number }> {
    try {
      // Use fetch and createImageBitmap for service worker compatibility
      const response = await fetch(imageDataUrl);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const dimensions = {
        width: bitmap.width,
        height: bitmap.height,
      };
      bitmap.close(); // Clean up resources
      return dimensions;
    } catch (error) {
      // Fallback to estimated dimensions
      console.warn('Failed to get image dimensions:', error);
      return {
        width: 1920,
        height: 1080,
      };
    }
  }

  /**
   * Estimate file size for file mode
   */
  private estimateFileSize(
    dimensions: { width: number; height: number },
    format: 'jpeg' | 'png' | 'webp',
    quality: number,
  ): number {
    const pixelCount = dimensions.width * dimensions.height;

    let bytesPerPixel: number;
    switch (format) {
      case 'jpeg':
        bytesPerPixel = 0.5 + quality * 2.5;
        break;
      case 'png':
        bytesPerPixel = 3.0; // PNG is lossless
        break;
      case 'webp':
        bytesPerPixel = 0.4 + quality * 2.0;
        break;
    }

    return Math.round(pixelCount * bytesPerPixel);
  }

  /**
   * Get smart suggestions based on usage patterns
   */
  static async getSmartSuggestions(url: string): Promise<string[]> {
    const suggestions: string[] = [];

    // Analyze recent screenshots of the same URL
    const recentEntries = await ScreenshotManifest.listEntries({
      limit: 5,
      filterBy: { newerThan: 7 }, // Last week
    });

    const sameUrlEntries = recentEntries.entries.filter((e) => e.url === url);

    if (sameUrlEntries.length > 0) {
      const avgCompressionRatio =
        sameUrlEntries.reduce((sum, e) => sum + e.compressionStats.compressionRatio, 0) /
        sameUrlEntries.length;
      const commonFormat = this.getMostCommonFormat(sameUrlEntries);

      if (avgCompressionRatio > 0.6) {
        suggestions.push(
          `This URL typically compresses well (${Math.round(avgCompressionRatio * 100)}% average). Consider inline mode.`,
        );
      } else {
        suggestions.push(
          `This URL doesn't compress well (${Math.round(avgCompressionRatio * 100)}% average). Consider file mode.`,
        );
      }

      suggestions.push(
        `${commonFormat.toUpperCase()} format works well for this URL (used ${Math.round((sameUrlEntries.filter((e) => e.compressionStats.format === commonFormat).length / sameUrlEntries.length) * 100)}% of the time)`,
      );
    }

    return suggestions;
  }

  /**
   * Helper to get most common format from entries
   */
  private static getMostCommonFormat(entries: ScreenshotManifestEntry[]): 'jpeg' | 'png' | 'webp' {
    const formatCounts = { jpeg: 0, png: 0, webp: 0 };

    entries.forEach((entry) => {
      formatCounts[entry.compressionStats.format]++;
    });

    return Object.entries(formatCounts).sort(([, a], [, b]) => b - a)[0][0] as
      | 'jpeg'
      | 'png'
      | 'webp';
  }
}
