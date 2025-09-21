-- LEED v5 BD+C Categories Data
-- This file contains the seed data for the categories table

-- Clear existing data (optional - uncomment if needed)
-- DELETE FROM public.categories;

-- Insert LEED v5 BD+C categories
INSERT INTO public.categories (
  id, 
  name, 
  description, 
  max_points, 
  levels, 
  strategies, 
  icon_key, 
  "order", 
  is_public
) VALUES 
(
  'location',
  'Location & Transportation',
  'Walk score, surrounding density, public transit, bicycle facilities, parking, electric vehicle charging',
  15,
  ARRAY['Rural', 'Suburban', 'Urban', 'Dense Urban'],
  'Optimize site selection',
  'building',
  1,
  true
),
(
  'sites',
  'Sustainable Sites',
  'Habitat protection, stormwater management, heat island reduction, resilient site design',
  11,
  ARRAY['Minimal', 'Moderate', 'Sustainable', 'Regenerative'],
  'Improve sustainable site design',
  'leaf',
  2,
  true
),
(
  'water',
  'Water Efficiency',
  'Water conservation, metering, efficient water fixtures',
  9,
  ARRAY['Standard', 'Efficient', 'Advanced', 'Exceptional'],
  'Enhance water conservation strategies',
  'droplets',
  3,
  true
),
(
  'energy',
  'Energy Efficiency',
  'Renewable energy, efficient envelope and HVAC, commissioning, metering, electrification',
  33,
  ARRAY['Standard', 'Efficient', 'Advanced', 'Net-Zero'],
  'Improve energy efficiency measures',
  'zap',
  4,
  true
),
(
  'materials',
  'Sustainable Materials ',
  'Recycled content, healthy materials, waste reduction, reduced embodied carbon',
  18,
  ARRAY['Convetional', 'Partially Sustainable', 'Sustainable', 'Regenerative'],
  'Enhance sustainable materials',
  'award',
  5,
  true
),
(
  'indoor',
  'Indoor Environmental Quality',
  'Air quality, biophilic design, daylight & glare control, acoustic, operable windows, thermal comfort',
  13,
  ARRAY['Basic', 'Confortable', 'Healthy', 'Exceptional'],
  'Improve indoor environmental quality',
  'trending_up',
  6,
  true
),
(
  'priorities',
  'Project Priorities',
  'Integrative process, innovative design, exemplary performance, LEED AP involvement, regional priority',
  11,
  ARRAY['Standard', 'Improved', 'Innovative', 'Groundbreaking'],
  'Respond to project and regional priorities',
  'lightbulb',
  7,
  true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  max_points = EXCLUDED.max_points,
  levels = EXCLUDED.levels,
  strategies = EXCLUDED.strategies,
  icon_key = EXCLUDED.icon_key,
  "order" = EXCLUDED."order",
  is_public = EXCLUDED.is_public;