/**
 * Test utilities for screenshot system tests
 */

export const testUtils = {
  /**
   * Create a mock base64 image data URL of approximate size in KB
   */
  createMockImageDataUrl(sizeKB: number): string {
    // Base64 encoding adds ~33% overhead, so for target size we need ~75% of chars
    const targetChars = Math.floor(sizeKB * 1024 * 0.75);
    const base64Data = 'A'.repeat(Math.max(100, targetChars));

    return `data:image/png;base64,${base64Data}`;
  },

  /**
   * Create mock Chrome API results
   */
  createMockChromeDownloadResult(id: number = 123): any {
    return {
      id,
      filename: `/path/to/screenshot-${id}.png`,
      state: 'complete',
      totalBytes: 15000,
      finalUrl: `file:///path/to/screenshot-${id}.png`,
    };
  },

  /**
   * Create mock tab information
   */
  createMockTab(id: number = 1, url: string = 'https://example.com'): any {
    return {
      id,
      url,
      title: 'Test Page',
      active: true,
      windowId: 1,
    };
  },

  /**
   * Generate mock image analysis results
   */
  createMockImageAnalysis(overrides: any = {}): any {
    return {
      hasText: false,
      textCoverage: 0.1,
      colorComplexity: 0.5,
      edgeDensity: 0.4,
      compressionSuitability: {
        jpeg: 0.8,
        png: 0.6,
        webp: 0.9,
      },
      ...overrides,
    };
  },
};
