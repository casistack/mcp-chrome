/**
 * Screenshot Storage Manifest System
 *
 * Provides comprehensive metadata tracking, deduplication, and retention
 * management for saved screenshots. Integrates with chrome.storage.local
 * for persistent storage across extension reloads.
 *
 * Features:
 * - Hash-based deduplication
 * - Automatic retention policies
 * - Storage quota management
 * - Privacy-conscious path handling
 */

import { generateScreenshotId, formatFilesize } from './screenshot-config';

export interface ScreenshotManifestEntry {
  id: string;
  hash: string; // For deduplication
  timestamp: number;
  url: string;
  title?: string; // Page title when captured
  dimensions: { width: number; height: number; dpr: number };
  storageMode: 'file' | 'base64';

  // File storage details
  filePath?: string; // Relative path (privacy-safe)
  absolutePath?: string; // Only if explicitly requested
  fileSize?: number; // File size in bytes

  // Base64 storage details (if stored inline)
  base64Size?: number; // Base64 string length

  // Compression metadata
  compressionStats: {
    originalSize: number;
    finalSize: number;
    format: 'jpeg' | 'png' | 'webp';
    quality: number;
    scale: number;
    compressionRatio: number;
    attempts: number;
    strategy: string;
  };

  // Usage tracking
  accessCount: number;
  lastAccessed: number;

  // Metadata
  tags?: string[];
  notes?: string;
  source: 'screenshot_tool' | 'manual' | 'auto_capture';

  // Cleanup tracking
  retentionScore: number; // For intelligent cleanup decisions
}

export interface ManifestStatistics {
  totalEntries: number;
  totalFileSize: number;
  totalBase64Size: number;
  storageBreakdown: {
    files: number;
    base64: number;
  };
  formatBreakdown: {
    jpeg: number;
    png: number;
    webp: number;
  };
  oldestEntry: number;
  newestEntry: number;
  duplicatesFound: number;
  avgCompressionRatio: number;
  storageQuotaUsed: number;
  storageQuotaTotal: number;
}

export interface RetentionPolicy {
  maxEntries: number;
  maxDays: number;
  minAccessCount: number; // Keep frequently accessed screenshots longer
  preserveTags: string[]; // Never delete screenshots with these tags
  maxStorageSize: number; // Total storage limit in bytes
}

export interface CleanupResult {
  deletedEntries: number;
  reclaimedSize: number;
  deletedFiles: string[];
  errors: string[];
  summary: string;
}

export class ScreenshotManifest {
  private static readonly STORAGE_KEY = 'screenshotManifest';
  private static readonly STATS_KEY = 'screenshotStats';
  private static readonly POLICY_KEY = 'retentionPolicy';

  private static readonly DEFAULT_RETENTION_POLICY: RetentionPolicy = {
    maxEntries: 50,
    maxDays: 7,
    minAccessCount: 2,
    preserveTags: ['important', 'favorite', 'keep'],
    maxStorageSize: 100 * 1024 * 1024, // 100MB
  };

  /**
   * Add new screenshot entry to manifest
   */
  static async addEntry(
    entry: Omit<
      ScreenshotManifestEntry,
      'id' | 'timestamp' | 'accessCount' | 'lastAccessed' | 'retentionScore'
    >,
  ): Promise<string> {
    const manifest = await this.loadManifest();

    // Check for duplicates based on hash
    const existingEntry = manifest.find((e) => e.hash === entry.hash);
    if (existingEntry) {
      // Update existing entry's access info and return existing ID
      existingEntry.accessCount++;
      existingEntry.lastAccessed = Date.now();
      existingEntry.retentionScore = this.calculateRetentionScore(existingEntry);

      await this.saveManifest(manifest);
      return existingEntry.id;
    }

    // Create new entry
    const newEntry: ScreenshotManifestEntry = {
      ...entry,
      id: generateScreenshotId(),
      timestamp: Date.now(),
      accessCount: 1,
      lastAccessed: Date.now(),
      retentionScore: 0.5, // Default score, will be updated over time
    };

    newEntry.retentionScore = this.calculateRetentionScore(newEntry);
    manifest.push(newEntry);

    await this.saveManifest(manifest);
    await this.updateStatistics();

    return newEntry.id;
  }

  /**
   * Get screenshot entry by ID
   */
  static async getEntry(id: string): Promise<ScreenshotManifestEntry | null> {
    const manifest = await this.loadManifest();
    const entry = manifest.find((e) => e.id === id);

    if (entry) {
      // Update access tracking
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      entry.retentionScore = this.calculateRetentionScore(entry);

      await this.saveManifest(manifest);
    }

    return entry || null;
  }

  /**
   * Delete screenshot entry and associated files
   */
  static async deleteEntry(id: string): Promise<boolean> {
    const manifest = await this.loadManifest();
    const entryIndex = manifest.findIndex((e) => e.id === id);

    if (entryIndex === -1) {
      return false;
    }

    const entry = manifest[entryIndex];

    // Delete associated file if it exists
    if (entry.storageMode === 'file' && entry.filePath) {
      try {
        // Note: In Chrome extension context, files are typically in Downloads folder
        // We can't directly delete them, but we can track them for manual cleanup
        console.log(`File deletion needed: ${entry.filePath}`);
      } catch (error) {
        console.warn(`Failed to delete file: ${entry.filePath}`, error);
      }
    }

    // Remove from manifest
    manifest.splice(entryIndex, 1);
    await this.saveManifest(manifest);
    await this.updateStatistics();

    return true;
  }

  /**
   * List screenshot entries with filtering and pagination
   */
  static async listEntries(
    options: {
      limit?: number;
      offset?: number;
      sortBy?: 'timestamp' | 'accessCount' | 'fileSize' | 'retentionScore';
      sortOrder?: 'asc' | 'desc';
      filterBy?: {
        storageMode?: 'file' | 'base64';
        format?: 'jpeg' | 'png' | 'webp';
        tags?: string[];
        minSize?: number;
        maxSize?: number;
        olderThan?: number; // Days
        newerThan?: number; // Days
      };
    } = {},
  ): Promise<{ entries: ScreenshotManifestEntry[]; total: number; hasMore: boolean }> {
    const {
      limit = 20,
      offset = 0,
      sortBy = 'timestamp',
      sortOrder = 'desc',
      filterBy = {},
    } = options;

    let manifest = await this.loadManifest();

    // Apply filters
    if (filterBy.storageMode) {
      manifest = manifest.filter((e) => e.storageMode === filterBy.storageMode);
    }

    if (filterBy.format) {
      manifest = manifest.filter((e) => e.compressionStats.format === filterBy.format);
    }

    if (filterBy.tags && filterBy.tags.length > 0) {
      manifest = manifest.filter(
        (e) => e.tags && filterBy.tags!.some((tag) => e.tags!.includes(tag)),
      );
    }

    if (filterBy.minSize) {
      manifest = manifest.filter((e) => (e.fileSize || e.base64Size || 0) >= filterBy.minSize!);
    }

    if (filterBy.maxSize) {
      manifest = manifest.filter((e) => (e.fileSize || e.base64Size || 0) <= filterBy.maxSize!);
    }

    if (filterBy.olderThan) {
      const cutoff = Date.now() - filterBy.olderThan * 24 * 60 * 60 * 1000;
      manifest = manifest.filter((e) => e.timestamp < cutoff);
    }

    if (filterBy.newerThan) {
      const cutoff = Date.now() - filterBy.newerThan * 24 * 60 * 60 * 1000;
      manifest = manifest.filter((e) => e.timestamp > cutoff);
    }

    // Apply sorting
    manifest.sort((a, b) => {
      let aValue: number, bValue: number;

      switch (sortBy) {
        case 'timestamp':
          aValue = a.timestamp;
          bValue = b.timestamp;
          break;
        case 'accessCount':
          aValue = a.accessCount;
          bValue = b.accessCount;
          break;
        case 'fileSize':
          aValue = a.fileSize || a.base64Size || 0;
          bValue = b.fileSize || b.base64Size || 0;
          break;
        case 'retentionScore':
          aValue = a.retentionScore;
          bValue = b.retentionScore;
          break;
        default:
          aValue = a.timestamp;
          bValue = b.timestamp;
      }

      return sortOrder === 'asc' ? aValue - bValue : bValue - aValue;
    });

    const total = manifest.length;
    const entries = manifest.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return { entries, total, hasMore };
  }

  /**
   * Perform cleanup based on retention policy
   */
  static async performCleanup(policy?: Partial<RetentionPolicy>): Promise<CleanupResult> {
    const effectivePolicy = { ...this.DEFAULT_RETENTION_POLICY, ...policy };
    const manifest = await this.loadManifest();

    const now = Date.now();
    const ageCutoff = now - effectivePolicy.maxDays * 24 * 60 * 60 * 1000;

    const toDelete: string[] = [];
    let totalSize = 0;

    // Calculate current total size
    manifest.forEach((entry) => {
      totalSize += entry.fileSize || entry.base64Size || 0;
    });

    // Sort by retention score (ascending - lowest scores deleted first)
    const sortedEntries = [...manifest].sort((a, b) => a.retentionScore - b.retentionScore);

    for (const entry of sortedEntries) {
      let shouldDelete = false;

      // Skip entries with preserve tags
      if (entry.tags && effectivePolicy.preserveTags.some((tag) => entry.tags!.includes(tag))) {
        continue;
      }

      // Age-based cleanup
      if (entry.timestamp < ageCutoff) {
        shouldDelete = true;
      }

      // Count-based cleanup (keep only most recent maxEntries)
      if (manifest.length - toDelete.length > effectivePolicy.maxEntries) {
        shouldDelete = true;
      }

      // Size-based cleanup
      if (totalSize > effectivePolicy.maxStorageSize) {
        shouldDelete = true;
      }

      // Keep frequently accessed items longer
      if (entry.accessCount >= effectivePolicy.minAccessCount) {
        shouldDelete = false;
      }

      if (shouldDelete) {
        toDelete.push(entry.id);
        totalSize -= entry.fileSize || entry.base64Size || 0;
      }
    }

    // Perform deletions
    const deletedFiles: string[] = [];
    const errors: string[] = [];
    let reclaimedSize = 0;

    for (const id of toDelete) {
      try {
        const entry = manifest.find((e) => e.id === id);
        if (entry) {
          if (entry.filePath) {
            deletedFiles.push(entry.filePath);
          }
          reclaimedSize += entry.fileSize || entry.base64Size || 0;
        }

        await this.deleteEntry(id);
      } catch (error) {
        errors.push(
          `Failed to delete ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    }

    await this.updateStatistics();

    return {
      deletedEntries: toDelete.length - errors.length,
      reclaimedSize,
      deletedFiles,
      errors,
      summary: `Deleted ${toDelete.length - errors.length} entries, reclaimed ${formatFilesize(reclaimedSize)}`,
    };
  }

  /**
   * Get manifest statistics
   */
  static async getStatistics(): Promise<ManifestStatistics> {
    const manifest = await this.loadManifest();

    if (manifest.length === 0) {
      return {
        totalEntries: 0,
        totalFileSize: 0,
        totalBase64Size: 0,
        storageBreakdown: { files: 0, base64: 0 },
        formatBreakdown: { jpeg: 0, png: 0, webp: 0 },
        oldestEntry: 0,
        newestEntry: 0,
        duplicatesFound: 0,
        avgCompressionRatio: 0,
        storageQuotaUsed: 0,
        storageQuotaTotal: 0,
      };
    }

    const stats: ManifestStatistics = {
      totalEntries: manifest.length,
      totalFileSize: 0,
      totalBase64Size: 0,
      storageBreakdown: { files: 0, base64: 0 },
      formatBreakdown: { jpeg: 0, png: 0, webp: 0 },
      oldestEntry: Math.min(...manifest.map((e) => e.timestamp)),
      newestEntry: Math.max(...manifest.map((e) => e.timestamp)),
      duplicatesFound: 0,
      avgCompressionRatio: 0,
      storageQuotaUsed: 0,
      storageQuotaTotal: 0,
    };

    const hashCounts = new Map<string, number>();
    let totalCompressionRatio = 0;

    for (const entry of manifest) {
      // Size tracking
      if (entry.storageMode === 'file') {
        stats.totalFileSize += entry.fileSize || 0;
        stats.storageBreakdown.files++;
      } else {
        stats.totalBase64Size += entry.base64Size || 0;
        stats.storageBreakdown.base64++;
      }

      // Format tracking
      stats.formatBreakdown[entry.compressionStats.format]++;

      // Duplicate detection
      const hashCount = hashCounts.get(entry.hash) || 0;
      hashCounts.set(entry.hash, hashCount + 1);
      if (hashCount > 0) {
        stats.duplicatesFound++;
      }

      // Compression ratio
      totalCompressionRatio += entry.compressionStats.compressionRatio;
    }

    stats.avgCompressionRatio = totalCompressionRatio / manifest.length;

    // Storage quota information (if available)
    try {
      const storageInfo = await chrome.storage.local.getBytesInUse();
      stats.storageQuotaUsed = storageInfo;
      stats.storageQuotaTotal = chrome.storage.local.QUOTA_BYTES || 10485760; // 10MB default
    } catch (error) {
      // Storage API not available or failed
      console.warn('Failed to get storage quota information:', error);
    }

    return stats;
  }

  /**
   * Load manifest from chrome.storage.local
   */
  private static async loadManifest(): Promise<ScreenshotManifestEntry[]> {
    try {
      const result = await chrome.storage.local.get(this.STORAGE_KEY);
      return result[this.STORAGE_KEY] || [];
    } catch (error) {
      console.error('Failed to load screenshot manifest:', error);
      return [];
    }
  }

  /**
   * Save manifest to chrome.storage.local
   */
  private static async saveManifest(manifest: ScreenshotManifestEntry[]): Promise<void> {
    try {
      await chrome.storage.local.set({ [this.STORAGE_KEY]: manifest });
    } catch (error) {
      console.error('Failed to save screenshot manifest:', error);
      throw error;
    }
  }

  /**
   * Update cached statistics
   */
  private static async updateStatistics(): Promise<void> {
    try {
      const stats = await this.getStatistics();
      await chrome.storage.local.set({ [this.STATS_KEY]: stats });
    } catch (error) {
      console.warn('Failed to update statistics cache:', error);
    }
  }

  /**
   * Calculate retention score for intelligent cleanup decisions
   */
  private static calculateRetentionScore(entry: ScreenshotManifestEntry): number {
    const now = Date.now();
    const ageInDays = (now - entry.timestamp) / (24 * 60 * 60 * 1000);
    const daysSinceAccess = (now - entry.lastAccessed) / (24 * 60 * 60 * 1000);

    let score = 0.5; // Base score

    // Recent screenshots get higher scores
    if (ageInDays < 1) score += 0.3;
    else if (ageInDays < 7) score += 0.2;
    else if (ageInDays < 30) score += 0.1;

    // Recently accessed screenshots get higher scores
    if (daysSinceAccess < 1) score += 0.2;
    else if (daysSinceAccess < 7) score += 0.1;

    // Frequently accessed screenshots get higher scores
    score += Math.min(0.2, entry.accessCount * 0.05);

    // Tagged screenshots get higher scores
    if (entry.tags && entry.tags.length > 0) {
      score += 0.1;
    }

    // Good compression ratio gets slight boost
    if (entry.compressionStats.compressionRatio > 0.5) {
      score += 0.05;
    }

    return Math.min(1.0, Math.max(0, score));
  }

  /**
   * Generate content-based SHA-256 hash for robust deduplication
   */
  static async generateContentHash(base64Data: string): Promise<string> {
    try {
      // Use crypto.subtle.digest for SHA-256 content hash
      // Extract the actual image data (remove data URI prefix)
      const base64Content = base64Data.split(',')[1] || base64Data;
      const binaryData = atob(base64Content);
      const uint8Array = new Uint8Array(binaryData.length);

      for (let i = 0; i < binaryData.length; i++) {
        uint8Array[i] = binaryData.charCodeAt(i);
      }

      const hashBuffer = await crypto.subtle.digest('SHA-256', uint8Array);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .substring(0, 16);
    } catch (error) {
      console.warn('Failed to generate content hash, falling back to simple hash:', error);
      return this.generateHash(base64Data);
    }
  }

  /**
   * Generate simple hash for deduplication (fallback)
   */
  static generateHash(data: string | ArrayBuffer): string {
    // Fallback simple hash function for deduplication
    let hash = 0;
    const str = typeof data === 'string' ? data : new TextDecoder().decode(data);

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }

    return Math.abs(hash).toString(36);
  }

  /**
   * Get or set retention policy
   */
  static async getRetentionPolicy(): Promise<RetentionPolicy> {
    try {
      const result = await chrome.storage.local.get(this.POLICY_KEY);
      return { ...this.DEFAULT_RETENTION_POLICY, ...result[this.POLICY_KEY] };
    } catch (error) {
      console.error('Failed to load retention policy:', error);
      return this.DEFAULT_RETENTION_POLICY;
    }
  }

  static async setRetentionPolicy(policy: Partial<RetentionPolicy>): Promise<void> {
    try {
      const currentPolicy = await this.getRetentionPolicy();
      const newPolicy = { ...currentPolicy, ...policy };
      await chrome.storage.local.set({ [this.POLICY_KEY]: newPolicy });
    } catch (error) {
      console.error('Failed to save retention policy:', error);
      throw error;
    }
  }

  /**
   * Export manifest data for backup
   */
  static async exportManifest(): Promise<string> {
    const manifest = await this.loadManifest();
    const stats = await this.getStatistics();
    const policy = await this.getRetentionPolicy();

    return JSON.stringify(
      {
        manifest,
        stats,
        policy,
        exportDate: new Date().toISOString(),
        version: '1.0.0',
      },
      null,
      2,
    );
  }

  /**
   * Import manifest data from backup
   */
  static async importManifest(data: string): Promise<{ success: boolean; message: string }> {
    try {
      const parsed = JSON.parse(data);

      if (!parsed.manifest || !Array.isArray(parsed.manifest)) {
        return { success: false, message: 'Invalid manifest format' };
      }

      await this.saveManifest(parsed.manifest);

      if (parsed.policy) {
        await this.setRetentionPolicy(parsed.policy);
      }

      await this.updateStatistics();

      return {
        success: true,
        message: `Imported ${parsed.manifest.length} entries successfully`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }
}
