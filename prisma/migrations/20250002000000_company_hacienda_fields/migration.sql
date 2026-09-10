-- Migration: company_hacienda_fields
-- Fase 1: Add Hacienda verification fields to companies table
-- All new columns are NULLABLE for backward compatibility with existing records (NFR-009)

-- Create HaciendaVerificationStatus enum
CREATE TYPE "HaciendaVerificationStatus" AS ENUM (
  'VERIFIED',
  'NOT_FOUND',
  'UNAVAILABLE',
  'ERROR',
  'SKIPPED'
);

-- Add nullable Hacienda verification columns to companies table
ALTER TABLE "companies"
  ADD COLUMN "hacienda_name" VARCHAR(255),
  ADD COLUMN "hacienda_verified_at" TIMESTAMP(3),
  ADD COLUMN "hacienda_verification_status" "HaciendaVerificationStatus";
