-- Migration: Add macros (carbs, protein, fat) to nutrition tracking tables
-- Run this in the Supabase SQL editor

-- Add macro columns to nutrition_logs
ALTER TABLE nutrition_logs
  ADD COLUMN IF NOT EXISTS carbs  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS protein integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fat     integer NOT NULL DEFAULT 0;

-- Add macro goal columns to nutrition_goals
ALTER TABLE nutrition_goals
  ADD COLUMN IF NOT EXISTS carbs_goal   integer,
  ADD COLUMN IF NOT EXISTS protein_goal integer,
  ADD COLUMN IF NOT EXISTS fat_goal     integer;
