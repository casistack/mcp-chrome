/**
 * Adaptive Compression Framework
 *
 * Implements progressive compression with multiple fallback strategies
 * to fit screenshots within token budget constraints while maintaining
 * acceptable quality.
 *
 * Integrates with the token estimation system for intelligent decision-making.
 */

import {
  estimateResponseTokens,
  estimateBase64Size,
  calculateCompressionRatio,
  generateScreenshotId,
  analyzeImageForFormat,
  type FormatAnalysisResult,
} from './screenshot-config';
import { compressImage } from './image-utils';

export interface CompressionCandidate {
  scale: number;
  quality: number;
  format: 'jpeg' | 'png' | 'webp';
  priority: number;
  description: string;
  estimatedTokens: number;
  estimatedSize: number;
}

export interface CompressionAttempt {
  candidate: CompressionCandidate;
  result: {
    success: boolean;
    dataUrl?: string;
    mimeType?: string;
    actualSize: number;
    actualTokens: number;
    compressionRatio: number;
    qualityScore?: number;
    error?: string;
  };
  duration: number;
}

export interface AdaptiveCompressionResult {
  success: boolean;
  bestResult?: {
    dataUrl: string;
    mimeType: string;
    base64Data: string;
    actualSize: number;
    actualTokens: number;
    compressionRatio: number;
    qualityScore: number;
    format: string;
    strategy: string;
  };
  attempts: CompressionAttempt[];
  totalDuration: number;
  recommendation: 'inline' | 'file' | 'retry_with_different_params';
  fallbackSuggestions: string[];
  contentAnalysis?: FormatAnalysisResult; // Content analysis results
  metadata: {
    id: string;
    timestamp: number;
    originalDimensions: { width: number; height: number };
    targetTokenBudget: number;
  };
}

export class AdaptiveCompressor {
  private static readonly DEFAULT_CANDIDATES: Omit<
    CompressionCandidate,
    'estimatedTokens' | 'estimatedSize'
  >[] = [
    {
      scale: 0.9,
      quality: 0.85,
      format: 'webp',
      priority: 1,
      description: 'High quality WebP with minimal scaling',
    },
    {
      scale: 0.8,
      quality: 0.8,
      format: 'webp',
      priority: 2,
      description: 'Good quality WebP with moderate scaling',
    },
    {
      scale: 0.8,
      quality: 0.75,
      format: 'jpeg',
      priority: 3,
      description: 'Good quality JPEG fallback',
    },
    {
      scale: 0.7,
      quality: 0.7,
      format: 'webp',
      priority: 4,
      description: 'Aggressive WebP compression',
    },
    {
      scale: 0.6,
      quality: 0.65,
      format: 'jpeg',
      priority: 5,
      description: 'Aggressive JPEG compression',
    },
    {
      scale: 0.5,
      quality: 0.6,
      format: 'jpeg',
      priority: 6,
      description: 'Maximum compression JPEG (last resort)',
    },
  ];

  /**
   * Compress image for inline delivery within token budget
   */
  static async compressForInline(
    imageDataUrl: string,
    params: {
      targetTokenBudget: number;
      maxAttempts?: number;
      preferredFormat?: 'jpeg' | 'png' | 'webp';
      minQuality?: number;
      originalWidth?: number;
      originalHeight?: number;
      enableContentAnalysis?: boolean;
    },
  ): Promise<AdaptiveCompressionResult> {
    const startTime = Date.now();
    const attempts: CompressionAttempt[] = [];
    const maxAttempts = params.maxAttempts ?? 6;
    const minQuality = params.minQuality ?? 0.5;
    const enableContentAnalysis = params.enableContentAnalysis ?? true;

    // Extract dimensions from image if not provided
    const { width, height } = await this.extractImageDimensions(imageDataUrl);
    const originalWidth = params.originalWidth ?? width;
    const originalHeight = params.originalHeight ?? height;

    // Perform content analysis for optimal format selection
    let contentAnalysis: FormatAnalysisResult | undefined;
    let recommendedFormat = params.preferredFormat;

    if (enableContentAnalysis) {
      try {
        contentAnalysis = await analyzeImageForFormat(imageDataUrl);

        // Use content analysis recommendation if no preference specified
        if (!params.preferredFormat) {
          recommendedFormat = contentAnalysis.recommended;
        }

        console.log(
          `Content analysis: ${contentAnalysis.reasoning} (confidence: ${contentAnalysis.confidence.toFixed(2)})`,
        );
      } catch (error) {
        console.warn('Content analysis failed, using defaults:', error);
      }
    }

    // Generate compression candidates based on content analysis
    const candidates = this.generateCandidates(
      originalWidth,
      originalHeight,
      params.targetTokenBudget,
      recommendedFormat,
      minQuality,
      contentAnalysis,
    );

    // Limit candidates by maxAttempts
    const selectedCandidates = candidates.slice(0, maxAttempts);

    let bestResult: AdaptiveCompressionResult['bestResult'] | undefined;
    const fallbackSuggestions: string[] = [];

    // Try each compression candidate
    for (const candidate of selectedCandidates) {
      const attemptStart = Date.now();

      try {
        const compressFormat =
          candidate.format === 'png'
            ? 'image/webp'
            : (`image/${candidate.format}` as 'image/jpeg' | 'image/webp');
        const compressed = await compressImage(imageDataUrl, {
          scale: candidate.scale,
          quality: candidate.quality,
          format: compressFormat,
        });

        const base64Data = compressed.dataUrl.replace(/^data:image\/[^;]+;base64,/, '');
        const actualSize = base64Data.length;
        const actualTokens = estimateResponseTokens(actualSize);
        const compressionRatio = calculateCompressionRatio(imageDataUrl.length, actualSize);
        const qualityScore = this.calculateQualityScore(
          candidate,
          compressionRatio,
          actualTokens,
          params.targetTokenBudget,
        );

        const attempt: CompressionAttempt = {
          candidate,
          result: {
            success: true,
            dataUrl: compressed.dataUrl,
            mimeType: compressed.mimeType,
            actualSize,
            actualTokens,
            compressionRatio,
            qualityScore,
          },
          duration: Date.now() - attemptStart,
        };

        attempts.push(attempt);

        // Check if this result fits within token budget
        if (actualTokens <= params.targetTokenBudget) {
          bestResult = {
            dataUrl: compressed.dataUrl,
            mimeType: compressed.mimeType,
            base64Data,
            actualSize,
            actualTokens,
            compressionRatio,
            qualityScore,
            format: candidate.format,
            strategy: candidate.description,
          };

          // If we found a good solution, we can stop
          if (qualityScore > 0.7) {
            break;
          }
        }
      } catch (error) {
        const attempt: CompressionAttempt = {
          candidate,
          result: {
            success: false,
            actualSize: 0,
            actualTokens: 0,
            compressionRatio: 0,
            error: error instanceof Error ? error.message : 'Unknown compression error',
          },
          duration: Date.now() - attemptStart,
        };

        attempts.push(attempt);
      }
    }

    // Generate fallback suggestions if no solution found
    if (!bestResult) {
      fallbackSuggestions.push('No compression strategy fit within token budget');
      fallbackSuggestions.push(
        `Consider using file mode or reducing target to ${Math.round(params.targetTokenBudget * 0.7)} tokens`,
      );

      if (originalWidth > 1280 || originalHeight > 720) {
        fallbackSuggestions.push(
          'Try capturing a smaller portion of the page or reducing browser zoom',
        );
      }
    }

    const totalDuration = Date.now() - startTime;
    const recommendation = this.determineRecommendation(
      bestResult,
      attempts,
      params.targetTokenBudget,
    );

    return {
      success: bestResult !== undefined,
      bestResult,
      attempts,
      totalDuration,
      recommendation,
      fallbackSuggestions,
      contentAnalysis, // Include content analysis results
      metadata: {
        id: generateScreenshotId(),
        timestamp: Date.now(),
        originalDimensions: { width: originalWidth, height: originalHeight },
        targetTokenBudget: params.targetTokenBudget,
      },
    };
  }

  /**
   * Generate compression candidates based on content analysis and constraints
   */
  private static generateCandidates(
    width: number,
    height: number,
    targetTokenBudget: number,
    preferredFormat?: 'jpeg' | 'png' | 'webp',
    minQuality: number = 0.5,
    contentAnalysis?: FormatAnalysisResult,
  ): CompressionCandidate[] {
    let baseCandidates = [...this.DEFAULT_CANDIDATES];

    // Enhance candidates based on content analysis
    if (contentAnalysis) {
      baseCandidates = this.optimizeCandidatesFromAnalysis(baseCandidates, contentAnalysis);
    }

    // Filter by minimum quality
    const filteredCandidates = baseCandidates.filter((c) => c.quality >= minQuality);

    // Add estimates and sort by priority
    const candidates: CompressionCandidate[] = filteredCandidates.map((candidate) => {
      const scaledWidth = Math.round(width * candidate.scale);
      const scaledHeight = Math.round(height * candidate.scale);
      const estimatedSize = estimateBase64Size(
        scaledWidth,
        scaledHeight,
        candidate.format,
        candidate.quality,
      );
      const estimatedTokens = estimateResponseTokens(estimatedSize);

      return {
        ...candidate,
        estimatedTokens,
        estimatedSize,
      };
    });

    // Sort by priority with intelligent format preference
    candidates.sort((a, b) => {
      // Content analysis recommendation gets highest priority
      if (contentAnalysis) {
        if (a.format === contentAnalysis.recommended && b.format !== contentAnalysis.recommended)
          return -1;
        if (b.format === contentAnalysis.recommended && a.format !== contentAnalysis.recommended)
          return 1;
      }

      // User preference gets second priority
      if (preferredFormat) {
        if (a.format === preferredFormat && b.format !== preferredFormat) return -1;
        if (b.format === preferredFormat && a.format !== preferredFormat) return 1;
      }

      // Fall back to default priority
      return a.priority - b.priority;
    });

    // Filter candidates that are obviously too large (>150% of budget)
    const viableCandidates = candidates.filter((c) => c.estimatedTokens <= targetTokenBudget * 1.5);

    return viableCandidates.length > 0 ? viableCandidates : candidates.slice(0, 3);
  }

  /**
   * Optimize compression candidates based on content analysis
   */
  private static optimizeCandidatesFromAnalysis(
    baseCandidates: Omit<CompressionCandidate, 'estimatedTokens' | 'estimatedSize'>[],
    contentAnalysis: FormatAnalysisResult,
  ): Omit<CompressionCandidate, 'estimatedTokens' | 'estimatedSize'>[] {
    const { characteristics, recommended, alternatives } = contentAnalysis;
    const enhancedCandidates = [...baseCandidates];

    // Adjust quality settings based on content type
    const qualityAdjustment = this.calculateQualityAdjustment(characteristics);

    // Create optimized candidates for the recommended format
    const recommendedCandidates = this.createOptimizedCandidates(
      recommended,
      characteristics,
      qualityAdjustment,
    );

    // Add alternative format candidates with lower priority
    const alternativeCandidates = alternatives
      .map((alt, index) =>
        this.createOptimizedCandidates(alt.format, characteristics, qualityAdjustment, index + 5),
      )
      .flat();

    // Combine and deduplicate
    const allCandidates = [
      ...recommendedCandidates,
      ...alternativeCandidates,
      ...enhancedCandidates,
    ];

    // Remove duplicates based on format + scale + quality combination
    const uniqueCandidates = allCandidates.reduce((unique, candidate) => {
      const key = `${candidate.format}-${candidate.scale}-${candidate.quality}`;
      if (!unique.has(key)) {
        unique.set(key, candidate);
      }
      return unique;
    }, new Map());

    return Array.from(uniqueCandidates.values()).sort((a, b) => a.priority - b.priority);
  }

  /**
   * Calculate quality adjustment based on image characteristics
   */
  private static calculateQualityAdjustment(
    characteristics: FormatAnalysisResult['characteristics'],
  ): {
    textBoost: number;
    photoBoost: number;
    qualityFloor: number;
  } {
    const { textContent, photoContent, hasTransparency, edgeComplexity } = characteristics;

    return {
      textBoost: textContent > 0.7 ? 0.1 : textContent > 0.5 ? 0.05 : 0, // Higher quality for text
      photoBoost: photoContent > 0.7 ? -0.05 : 0, // Slightly lower quality acceptable for photos
      qualityFloor: hasTransparency || edgeComplexity > 0.5 ? 0.7 : 0.6, // Higher floor for complex content
    };
  }

  /**
   * Create optimized candidates for a specific format
   */
  private static createOptimizedCandidates(
    format: 'jpeg' | 'png' | 'webp',
    characteristics: FormatAnalysisResult['characteristics'],
    qualityAdjustment: ReturnType<typeof AdaptiveCompressor.calculateQualityAdjustment>,
    priorityOffset: number = 0,
  ): Omit<CompressionCandidate, 'estimatedTokens' | 'estimatedSize'>[] {
    const { textContent, photoContent, hasTransparency } = characteristics;
    const { textBoost, photoBoost, qualityFloor } = qualityAdjustment;

    const candidates: Omit<CompressionCandidate, 'estimatedTokens' | 'estimatedSize'>[] = [];

    // Base quality and scale combinations optimized for content type
    if (textContent > 0.6) {
      // Text-heavy content: prioritize quality and sharpness
      candidates.push(
        {
          scale: 1.0,
          quality: Math.max(qualityFloor, 0.9 + textBoost),
          format,
          priority: 1 + priorityOffset,
          description: `High quality ${format.toUpperCase()} optimized for text content`,
        },
        {
          scale: 0.9,
          quality: Math.max(qualityFloor, 0.85 + textBoost),
          format,
          priority: 2 + priorityOffset,
          description: `Good quality ${format.toUpperCase()} for text with minimal scaling`,
        },
      );
    } else if (photoContent > 0.6) {
      // Photo content: balance quality and compression
      candidates.push(
        {
          scale: 0.9,
          quality: Math.max(qualityFloor, 0.8 + photoBoost),
          format,
          priority: 1 + priorityOffset,
          description: `Optimized ${format.toUpperCase()} for photographic content`,
        },
        {
          scale: 0.8,
          quality: Math.max(qualityFloor, 0.75 + photoBoost),
          format,
          priority: 2 + priorityOffset,
          description: `Balanced ${format.toUpperCase()} for photos with good compression`,
        },
        {
          scale: 0.7,
          quality: Math.max(qualityFloor, 0.7 + photoBoost),
          format,
          priority: 3 + priorityOffset,
          description: `Aggressive ${format.toUpperCase()} compression for photos`,
        },
      );
    } else {
      // Mixed content: versatile approach
      candidates.push(
        {
          scale: 0.85,
          quality: Math.max(qualityFloor, 0.8),
          format,
          priority: 1 + priorityOffset,
          description: `Balanced ${format.toUpperCase()} for mixed content`,
        },
        {
          scale: 0.75,
          quality: Math.max(qualityFloor, 0.75),
          format,
          priority: 2 + priorityOffset,
          description: `Moderate ${format.toUpperCase()} compression for mixed content`,
        },
      );
    }

    // Special handling for transparency
    if (hasTransparency && format === 'png') {
      candidates.unshift({
        scale: 1.0,
        quality: 1.0, // PNG is lossless anyway
        format,
        priority: priorityOffset,
        description: 'PNG lossless for transparency preservation',
      });
    }

    return candidates;
  }

  /**
   * Enhanced quality score calculation with content-aware weighting
   */
  private static calculateQualityScore(
    candidate: CompressionCandidate,
    compressionRatio: number,
    actualTokens: number,
    targetTokenBudget: number,
  ): number {
    // Base quality score from candidate settings
    let score = candidate.quality * 0.35; // 35% weight on original quality setting

    // Scale factor contribution (higher scale = better quality)
    score += candidate.scale * 0.25; // 25% weight on scale

    // Token budget efficiency (fitting within budget is crucial)
    const tokenEfficiency =
      actualTokens <= targetTokenBudget
        ? 1.0
        : Math.max(0, 1.0 - (actualTokens - targetTokenBudget) / targetTokenBudget);
    score += tokenEfficiency * 0.25; // 25% weight on token efficiency

    // Compression efficiency (good compression without excessive quality loss)
    const compressionEfficiency = Math.min(1.0, compressionRatio * 2); // Favor good compression
    score += compressionEfficiency * 0.1; // 10% weight on compression

    // Format suitability bonus (WebP generally preferred)
    if (candidate.format === 'webp') {
      score += 0.05; // 5% bonus for modern format
    }

    // Strategy description bonus (content-optimized strategies get slight boost)
    if (
      candidate.description.includes('optimized for') ||
      candidate.description.includes('transparency')
    ) {
      score += 0.02; // Small bonus for content-aware strategies
    }

    return Math.min(1.0, Math.max(0, score));
  }

  /**
   * Determine recommendation based on compression results
   */
  private static determineRecommendation(
    bestResult: AdaptiveCompressionResult['bestResult'],
    attempts: CompressionAttempt[],
    targetTokenBudget: number,
  ): 'inline' | 'file' | 'retry_with_different_params' {
    if (bestResult && bestResult.actualTokens <= targetTokenBudget) {
      return bestResult.qualityScore > 0.5 ? 'inline' : 'retry_with_different_params';
    }

    // If all attempts failed to fit budget
    const minTokens = Math.min(
      ...attempts.filter((a) => a.result.success).map((a) => a.result.actualTokens),
    );
    if (minTokens > targetTokenBudget * 1.5) {
      return 'file';
    }

    return 'retry_with_different_params';
  }

  /**
   * Extract image dimensions from data URL
   */
  private static async extractImageDimensions(
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
      throw new Error(`Failed to load image for dimension extraction: ${error}`);
    }
  }

  /**
   * Generate thumbnail for large images (optional feature)
   */
  static async generateThumbnail(
    imageDataUrl: string,
    maxSize: { width: number; height: number } = { width: 200, height: 150 },
  ): Promise<{ dataUrl: string; mimeType: string }> {
    const { width, height } = await this.extractImageDimensions(imageDataUrl);

    // Calculate scale to fit within maxSize while maintaining aspect ratio
    const scaleX = maxSize.width / width;
    const scaleY = maxSize.height / height;
    const scale = Math.min(scaleX, scaleY, 1.0); // Never upscale

    return compressImage(imageDataUrl, {
      scale,
      quality: 0.7,
      format: 'image/jpeg', // JPEG is fine for small thumbnails
    });
  }
}

/**
 * Utility functions for compression analysis
 */

/**
 * Analyze compression effectiveness across multiple attempts
 */
export function analyzeCompressionEffectiveness(result: AdaptiveCompressionResult): {
  bestAttempt: CompressionAttempt | null;
  avgCompressionRatio: number;
  successRate: number;
  recommendations: string[];
} {
  const successfulAttempts = result.attempts.filter((a) => a.result.success);
  const bestAttempt = successfulAttempts.reduce(
    (best, current) =>
      !best || (current.result.qualityScore ?? 0) > (best.result.qualityScore ?? 0)
        ? current
        : best,
    null as CompressionAttempt | null,
  );

  const avgCompressionRatio =
    successfulAttempts.length > 0
      ? successfulAttempts.reduce((sum, a) => sum + a.result.compressionRatio, 0) /
        successfulAttempts.length
      : 0;

  const successRate =
    result.attempts.length > 0 ? successfulAttempts.length / result.attempts.length : 0;

  const recommendations: string[] = [];

  if (successRate < 0.5) {
    recommendations.push('Low compression success rate. Check image format support.');
  }

  if (avgCompressionRatio < 0.3) {
    recommendations.push('Poor compression ratio. Consider different source image format.');
  }

  if (result.totalDuration > 2000) {
    recommendations.push('Compression taking too long. Reduce number of attempts or image size.');
  }

  return {
    bestAttempt,
    avgCompressionRatio,
    successRate,
    recommendations,
  };
}

/**
 * Content-aware format recommendation
 * Analyzes image characteristics to suggest optimal format
 */
export async function recommendFormat(imageDataUrl: string): Promise<{
  recommended: 'jpeg' | 'png' | 'webp';
  confidence: number;
  reasoning: string;
}> {
  try {
    // This would ideally analyze image content, but for now use simple heuristics
    const isLikelyPhoto = imageDataUrl.includes('jpeg') || imageDataUrl.includes('jpg');
    const isLikelyUI = imageDataUrl.includes('png') || imageDataUrl.length < 100000; // Smaller images often UI

    if (isLikelyPhoto) {
      return {
        recommended: 'webp',
        confidence: 0.8,
        reasoning: 'Photographic content detected. WebP offers excellent compression for photos.',
      };
    } else if (isLikelyUI) {
      return {
        recommended: 'webp',
        confidence: 0.7,
        reasoning: 'UI/text content detected. WebP lossless mode ideal for sharp graphics.',
      };
    } else {
      return {
        recommended: 'webp',
        confidence: 0.6,
        reasoning: 'Unknown content type. WebP provides good balance for mixed content.',
      };
    }
  } catch (error) {
    return {
      recommended: 'webp',
      confidence: 0.5,
      reasoning: 'Content analysis failed. Defaulting to WebP as general-purpose format.',
    };
  }
}
