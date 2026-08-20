import { z } from "astro/zod";

import { assertCrossOrigin, validateEmbedUrl } from "./embed-url";

type ReferenceLike = string | { id?: string; slug?: string };

type GameSchemaOptions<
  TImageSchema extends z.ZodType,
  TCategoryReferenceSchema extends z.ZodType,
  TGameReferenceSchema extends z.ZodType,
> = {
  imageSchema: TImageSchema;
  categoryReferenceSchema: TCategoryReferenceSchema;
  gameReferenceSchema: TGameReferenceSchema;
  allowedOrigins: readonly URL[];
  siteOrigin: URL;
  entryId?: string;
};

const trimmedString = (minimum: number, maximum: number) =>
  z.string().trim().min(minimum).max(maximum);

const referenceId = (reference: unknown): string | undefined => {
  if (typeof reference === "string") {
    return reference;
  }

  if (reference && typeof reference === "object") {
    const value = reference as Exclude<ReferenceLike, string>;
    return value.id ?? value.slug;
  }

  return undefined;
};

export const assertNoSelfReference = (
  entryId: string,
  relatedGames: readonly unknown[],
): void => {
  if (relatedGames.some((reference) => referenceId(reference) === entryId)) {
    throw new Error(`Game ${entryId} cannot reference itself in relatedGames`);
  }
};

const createEmbedUrlSchema = (
  allowedOrigins: readonly URL[],
  siteOrigin: URL,
) =>
  z.string().transform((raw, context) => {
    try {
      return assertCrossOrigin(
        validateEmbedUrl(raw, allowedOrigins),
        siteOrigin,
      ).href;
    } catch (error) {
      context.addIssue({
        code: "custom",
        message:
          error instanceof Error ? error.message : "embedUrl is not valid",
      });
      return z.NEVER;
    }
  });

const greatestCommonDivisor = (left: bigint, right: bigint): bigint => {
  let a = left;
  let b = right;

  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }

  return a;
};

const aspectRatioSchema = z
  .string()
  .trim()
  .transform((raw, context) => {
    const match = /^(\d+)\/(\d+)$/.exec(raw);

    const numeratorValue = match?.[1];
    const denominatorValue = match?.[2];

    if (!numeratorValue || !denominatorValue) {
      context.addIssue({
        code: "custom",
        message: "aspectRatio must contain two positive integers",
      });
      return z.NEVER;
    }

    const numerator = BigInt(numeratorValue);
    const denominator = BigInt(denominatorValue);

    if (numerator <= 0n || denominator <= 0n) {
      context.addIssue({
        code: "custom",
        message: "aspectRatio values must be greater than zero",
      });
      return z.NEVER;
    }

    const divisor = greatestCommonDivisor(numerator, denominator);
    return `${numerator / divisor}/${denominator / divisor}`;
  });

export const createGameSchema = <
  TImageSchema extends z.ZodType,
  TCategoryReferenceSchema extends z.ZodType,
  TGameReferenceSchema extends z.ZodType,
>({
  imageSchema,
  categoryReferenceSchema,
  gameReferenceSchema,
  allowedOrigins,
  siteOrigin,
  entryId,
}: GameSchemaOptions<
  TImageSchema,
  TCategoryReferenceSchema,
  TGameReferenceSchema
>) =>
  z
    .object({
      title: trimmedString(1, 80),
      seoTitle: trimmedString(20, 65),
      seoDescription: trimmedString(70, 170),
      shortDescription: trimmedString(20, 200),
      coverImage: imageSchema,
      coverAlt: trimmedString(1, 180),
      screenshots: z
        .array(
          z.object({
            image: imageSchema,
            alt: trimmedString(1, 180),
          }),
        )
        .max(8),
      embedUrl: createEmbedUrlSchema(allowedOrigins, siteOrigin),
      categories: z.array(categoryReferenceSchema).min(1),
      tags: z.array(trimmedString(1, 40)).max(12),
      controls: z
        .array(
          z.object({
            input: trimmedString(1, 80),
            action: trimmedString(1, 160),
          }),
        )
        .min(1),
      featured: z.boolean(),
      mobileSupport: z.enum(["yes", "no", "partial"]),
      orientation: z.enum(["landscape", "portrait", "both"]),
      loadMode: z.enum(["click", "eager"]),
      aspectRatio: aspectRatioSchema,
      status: z.enum(["draft", "published"]),
      publishedAt: z.coerce.date(),
      updatedAt: z.coerce.date(),
      source: z.object({
        name: trimmedString(1, 120),
        url: z.url().refine((value) => new URL(value).protocol === "https:", {
          message: "source.url must use HTTPS",
        }),
        license: trimmedString(1, 200),
      }),
      relatedGames: z.array(gameReferenceSchema).max(8),
    })
    .superRefine((game, context) => {
      if (game.updatedAt < game.publishedAt) {
        context.addIssue({
          code: "custom",
          path: ["updatedAt"],
          message: "updatedAt cannot be earlier than publishedAt",
        });
      }

      if (
        entryId &&
        game.relatedGames.some(
          (reference) => referenceId(reference) === entryId,
        )
      ) {
        context.addIssue({
          code: "custom",
          path: ["relatedGames"],
          message: "relatedGames cannot reference the current game",
        });
      }
    });

export const createCategorySchema = () =>
  z.object({
    name: trimmedString(1, 80),
    seoTitle: trimmedString(20, 65),
    seoDescription: trimmedString(70, 170),
    shortDescription: trimmedString(20, 200),
    order: z.number().int().nonnegative(),
    featured: z.boolean(),
    status: z.enum(["draft", "published"]),
  });
