"use client";

import { Check, Plus, Users } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addCategory,
  addFunction,
  hasCategoryNamed,
  hasFunctionNamed,
  renameCategory,
  setSpaces,
  type FunctionTaxonomy,
} from "@/lib/projects/function-taxonomy";
import { cn } from "@/lib/utils";

/**
 * Making a category, and saying what goes in it.
 *
 * One form for both halves of the job. A category nobody has tagged anything
 * into is invisible everywhere it would matter, so asking for the name and
 * then leaving the reader to find the spaces one at a time would mean most
 * categories stayed empty. The spaces are therefore part of making the
 * thing, not a second errand.
 *
 * A function can be made from the same form, because a reader who needs a
 * category under a part of the organisation TOME has not heard of should not
 * have to go elsewhere first.
 */

/** The little the form needs to know about a space to offer it. */
export interface TaggableSpace {
  slug: string;
  title: string;
}

export interface CategoryDraft {
  /** The function the category belongs to. */
  functionId: string;
  /** Set when an existing category is being changed rather than made. */
  categoryId?: string;
  name: string;
  spaces: string[];
}

export function FunctionCategoryDialog({
  open,
  onOpenChange,
  taxonomy,
  spaces,
  draft,
  onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taxonomy: FunctionTaxonomy;
  /** Every space the reader can see, to tag into the category. */
  spaces: TaggableSpace[];
  /** What the form opens on: a blank category under a function, or one to change. */
  draft: CategoryDraft;
  onCommit: (next: (current: FunctionTaxonomy) => FunctionTaxonomy) => void;
}) {
  const [functionId, setFunctionId] = React.useState(draft.functionId);
  const [name, setName] = React.useState(draft.name);
  const [picked, setPicked] = React.useState<string[]>(draft.spaces);
  const [newFunction, setNewFunction] = React.useState("");
  const [addingFunction, setAddingFunction] = React.useState(false);
  const [search, setSearch] = React.useState("");

  // Keyed by the draft rather than reset in an effect: opening the form on a
  // different category is a different form, and a form that remembers the
  // last one shows the wrong name for a frame.
  const key = `${draft.functionId}:${draft.categoryId ?? "new"}`;
  const [lastKey, setLastKey] = React.useState(key);
  if (lastKey !== key) {
    setLastKey(key);
    setFunctionId(draft.functionId);
    setName(draft.name);
    setPicked(draft.spaces);
    setNewFunction("");
    setAddingFunction(false);
    setSearch("");
  }

  const editing = Boolean(draft.categoryId);
  const trimmed = name.trim();
  const clash =
    !editing && trimmed !== "" && hasCategoryNamed(taxonomy, functionId, trimmed);
  const functionClash =
    newFunction.trim() !== "" && hasFunctionNamed(taxonomy, newFunction);

  const matching = search.trim()
    ? spaces.filter((space) =>
        space.title.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : spaces;

  const commit = () => {
    if (!trimmed || clash) return;
    onCommit((current) => {
      if (draft.categoryId) {
        return setSpaces(
          renameCategory(current, draft.categoryId, trimmed),
          draft.categoryId,
          picked,
        );
      }
      return addCategory(current, functionId, trimmed, picked).taxonomy;
    });
    onOpenChange(false);
  };

  const createFunction = () => {
    const wanted = newFunction.trim();
    if (!wanted || functionClash) return;
    onCommit((current) => {
      const { taxonomy: next, id } = addFunction(current, wanted);
      // Selected here rather than after the commit: the id is only known
      // inside this call, and the reader meant to put the category in it.
      if (id) setFunctionId(id);
      return next;
    });
    setNewFunction("");
    setAddingFunction(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit category" : "New category"}</DialogTitle>
          <DialogDescription>
            A category is how one function divides its own work. Spaces tagged
            into it find each other from their own navigation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Function</Label>
            <div className="flex flex-wrap gap-1.5">
              {taxonomy.functions.map((fn) => (
                <button
                  key={fn.id}
                  type="button"
                  aria-pressed={fn.id === functionId}
                  onClick={() => setFunctionId(fn.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition",
                    fn.id === functionId
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {fn.name}
                </button>
              ))}

              {!addingFunction && !editing && (
                <button
                  type="button"
                  onClick={() => setAddingFunction(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground"
                >
                  <Plus className="h-3 w-3" aria-hidden />
                  New function
                </button>
              )}
            </div>

            {addingFunction && (
              <div className="flex items-start gap-2 pt-1">
                <div className="flex-1">
                  <Input
                    autoFocus
                    aria-label="Name of the new function"
                    placeholder="Name of the function"
                    value={newFunction}
                    onChange={(e) => setNewFunction(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        createFunction();
                      }
                    }}
                  />
                  {functionClash && (
                    <p className="mt-1 text-xs text-amber-500">
                      That function already exists.
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={createFunction}
                  disabled={!newFunction.trim() || functionClash}
                >
                  Add
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <Input
              id="category-name"
              autoFocus={!addingFunction}
              placeholder="What this part of the work is called"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commit();
                }
              }}
            />
            {clash && (
              <p className="text-xs text-amber-500">
                That function already has a category by this name.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <Label>Spaces</Label>
              <span className="text-xs text-muted-foreground">
                {picked.length} tagged
              </span>
            </div>

            {spaces.length > 8 && (
              <Input
                aria-label="Filter the spaces"
                placeholder="Filter spaces"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}

            {/* Scrolled rather than paged: the whole catalogue is here, and
                a reader tagging four of forty should not lose the ones they
                already ticked by moving between pages. */}
            <ul className="max-h-52 space-y-0.5 overflow-y-auto rounded-lg border border-border p-1">
              {matching.length === 0 ? (
                <li className="px-2 py-3 text-xs text-muted-foreground">
                  No space by that name.
                </li>
              ) : (
                matching.map((space) => {
                  const on = picked.includes(space.slug);
                  return (
                    <li key={space.slug}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() =>
                          setPicked((current) =>
                            current.includes(space.slug)
                              ? current.filter((s) => s !== space.slug)
                              : [...current, space.slug],
                          )
                        }
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition",
                          on
                            ? "bg-primary/10 text-foreground"
                            : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                        )}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            on ? "border-primary bg-primary/20" : "border-border",
                          )}
                        >
                          {on && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0 truncate">{space.title}</span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={!trimmed || clash}>
            <Users className="h-4 w-4" />
            {editing ? "Save category" : "Create category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
