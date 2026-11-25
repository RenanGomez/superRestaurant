import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { RecipeVersionV1 } from "@super-restaurant/shared-types";

import { getAuthenticatedPrincipal, RateLimited } from "../auth/authentication.js";
import {
  RecipeApplicationError,
  RecipesService,
  type RecipeVersionListV1,
} from "./recipes.service.js";

@Controller("inventory")
export class RecipesController {
  public constructor(
    @Inject(RecipesService) private readonly recipes: RecipesService,
  ) {}

  @Post("recipes")
  @HttpCode(201)
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async publishRecipe(@Req() request: unknown, @Body() body: unknown): Promise<RecipeVersionV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.recipes.publishRecipe(principal, body));
  }

  @Get("recipes")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async listRecipes(@Req() request: unknown, @Query() query: unknown): Promise<RecipeVersionListV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.recipes.listRecipes(principal, query));
  }

  @Get("recipes/:id")
  @Header("Cache-Control", "private, no-store")
  @RateLimited({ limit: 120, windowMs: 60_000 })
  public async readRecipe(
    @Req() request: unknown,
    @Param("id") id: string,
    @Query() query: unknown,
  ): Promise<RecipeVersionV1> {
    const principal = getAuthenticatedPrincipal(request);
    return this.execute(() => this.recipes.readRecipeById(principal, id, query));
  }

  private async execute<Result>(action: () => Promise<Result>): Promise<Result> {
    try {
      return await action();
    } catch (error: unknown) {
      if (error instanceof RecipeApplicationError) {
        if (error.code === "request") throw new BadRequestException({ code: "INVENTORY_REQUEST_INVALID" });
        if (error.code === "authorization") throw new ForbiddenException({ code: "ACTION_NOT_AUTHORIZED" });
        if (error.code === "conflict") throw new ConflictException({ code: "INVENTORY_CONFLICT" });
        if (error.code === "missing") throw new NotFoundException({ code: "INVENTORY_NOT_FOUND" });
      }
      throw new ServiceUnavailableException({ code: "INVENTORY_UNAVAILABLE" });
    }
  }
}
