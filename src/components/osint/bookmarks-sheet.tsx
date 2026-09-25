"use client";

import {
  ExternalLink,
  Trash2,
  Bookmark,
  FolderOpen,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export interface BookmarkItem {
  id: string;
  title: string;
  url: string;
  snippet?: string | null;
  module?: string | null;
  moduleName?: string | null;
  query?: string | null;
  createdAt: string;
}

export function BookmarksSheet({
  bookmarks,
  loading,
  onOpenChange,
  onRemove,
  open,
  children,
}: {
  bookmarks: BookmarkItem[];
  loading: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: (id: string) => void;
  open: boolean;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle className="flex items-center gap-2 text-base">
            <Bookmark className="w-4 h-4 text-emerald-400" />
            Saqlangan topilmalar
            <span className="text-xs font-normal text-muted-foreground ml-1">
              ({bookmarks.length})
            </span>
          </SheetTitle>
          <SheetDescription className="text-xs">
            Skaner davomida yoqqan topilmalarni &quot;Saqlash&quot; tugmasi bilan
            shu yerga qo&apos;shasiz.
          </SheetDescription>
        </SheetHeader>
        <Separator />
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-3">
            {loading ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Yuklanmoqda...
              </p>
            ) : bookmarks.length === 0 ? (
              <div className="text-center py-10">
                <FolderOpen className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Hozircha hech narsa saqlanmagan.
                </p>
              </div>
            ) : (
              bookmarks.map((b) => (
                <div
                  key={b.id}
                  className="rounded-lg border bg-card p-3 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <a
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium leading-snug hover:text-emerald-400 transition-colors line-clamp-2"
                    >
                      {b.title}
                    </a>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-400"
                      onClick={() => onRemove(b.id)}
                      aria-label="O'chirish"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {b.snippet && (
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {b.snippet}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    {b.moduleName && (
                      <span className="px-1.5 py-0.5 rounded bg-secondary text-emerald-500">
                        {b.moduleName}
                      </span>
                    )}
                    {b.query && <span className="truncate">maqsad: {b.query}</span>}
                    <a
                      href={b.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 hover:text-emerald-400"
                    >
                      ochish <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
