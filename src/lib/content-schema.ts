import { z } from "astro/zod";

type ReferenceLike = string | { id?: string; slug?: string };

type GameSchemaOptions<
  TImageSchema extends z.ZodType,
  TCategoryReferenceSchema extends z.ZodType,
  TGameReferenceSchema extends z.ZodType,
> = {
  imageSchema: TImageSchema;
  categoryReferenceSchema: TCategoryReferenceSchema;
  gameReferenceSchema: TGameReferenceSchema;
  allowedOrigins: ReadonlySet<string>;
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

export const parseAllowedGameOrigins = (raw: string): ReadonlySet<string> => {
  const origins = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const url = new URL(value);

      if (url.protocol !== "https:" || url.origin !== value) {
        throw new Error(
          `PUBLIC_GAME_ORIGINS entries must be HTTPS origins: ${value}`,
        );
      }

      return url.origin;
    });

  if (origins.length === 0) {
    throw new Error(
      "PUBLIC_GAME_ORIGINS must contain at least one HTTPS origin",
    );
  }

  return new Set(origins);
};

export const assertNoSelfReference = (
  entryId: string,
  relatedGames: readonly unknown[],
): void => {
  if (relatedGames.some((reference) => referenceId(reference) === entryId)) {
    throw new Error(`Game ${entryId} cannot reference itself in relatedGames`);
  }
};

const createEmbedUrlSchema = (allowedOrigins: ReadonlySet<string>) =>
  z.url().superRefine((raw, context) => {
    const url = new URL(raw);

    if (url.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "embedUrl must use HTTPS" });
    }

    if (!allowedOrigins.has(url.origin)) {
      context.addIssue({
        code: "custom",
        message: `embedUrl origin is not allowed: ${url.origin}`,
      });
    }

    if (url.username || url.password || url.hash) {
      context.addIssue({
        code: "custom",
        message: "embedUrl cannot contain credentials or a fragment",
      });
    }

    if (!url.pathname.endsWith("/")) {
      context.addIssue({
        code: "custom",
        message: "embedUrl path must end with a trailing slash",
      });
    }
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
      embedUrl: createEmbedUrlSchema(allowedOrigins),
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
      indexable: z.boolean(),
      mobileSupport: z.enum(["yes", "no", "partial"]),
      orientation: z.enum(["landscape", "portrait", "both"]),
      loadMode: z.enum(["click", "eager"]),
      aspectRatio: z.string().regex(/^\d+\/\d+$/),
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
