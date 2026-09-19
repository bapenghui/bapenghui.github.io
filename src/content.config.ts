import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const commonFields = {
  title: z.string().min(1),
  summary: z.string().min(1),
  publishedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  tags: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
  visibility: z.enum(['public', 'private']).default('public'),
  featured: z.boolean().default(false),
  sample: z.boolean().default(false),
};

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    ...commonFields,
    status: z.enum(['idea', 'researching', 'in-progress', 'complete', 'paused']),
    accent: z.enum(['rust', 'sage', 'blue']).default('rust'),
    currentFocus: z.string(),
    timeline: z.array(z.object({ date: z.coerce.date(), text: z.string() })).default([]),
    relatedWriting: z.array(z.string()).default([]),
  }),
});

const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z.object({
    ...commonFields,
    category: z.string(),
    readingMinutes: z.number().int().positive(),
    relatedProjects: z.array(z.string()).default([]),
  }),
});

const photos = defineCollection({
  loader: glob({ pattern: '**/*.yaml', base: './src/content/photos' }),
  schema: z.object({
    ...commonFields,
    alt: z.string().min(1),
    src: z.string().min(1),
    category: z.string(),
    accent: z.enum(['rust', 'sage', 'blue', 'sand']),
    orientation: z.enum(['landscape', 'portrait', 'square']).default('landscape'),
    source: z.string().optional(),
    relatedProjects: z.array(z.string()).default([]),
  }),
});

export const collections = { projects, writing, photos };
