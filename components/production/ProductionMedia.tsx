"use client";

import { useState } from "react";
import Image from "next/image";

interface MediaFile {
  id: number;
  type: "image" | "video";
  url: string;
  name: string;
}

export default function ProductionMedia() {
  const [files, setFiles] = useState<MediaFile[]>([]);

  function handleUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files;

    if (!selected) return;

    const uploaded: MediaFile[] = [];

    Array.from(selected).forEach((file, index) => {
      uploaded.push({
        id: Date.now() + index,
        type: file.type.startsWith("video") ? "video" : "image",
        url: URL.createObjectURL(file),
        name: file.name,
      });
    });

    setFiles((prev) => [...prev, ...uploaded]);
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

      <div className="mb-6 flex items-center justify-between">

        <h2 className="text-2xl font-bold text-white">
          Фото и видео объекта
        </h2>

        <label className="cursor-pointer rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700">
          Загрузить

          <input
            hidden
            multiple
            type="file"
            accept="image/*,video/*"
            onChange={handleUpload}
          />

        </label>

      </div>

      {files.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-600 p-10 text-center text-slate-400">
          Пока нет загруженных файлов
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">

        {files.map((file) => (

          <div
            key={file.id}
            className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900"
          >

            {file.type === "image" ? (
              <Image
                src={file.url}
                alt={file.name}
                className="h-52 w-full object-cover"
                width={640}
                height={208}
                unoptimized
              />
            ) : (
              <video
                controls
                className="h-52 w-full"
              >
                <source src={file.url} />
              </video>
            )}

            <div className="p-3">

              <p className="truncate text-sm text-white">
                {file.name}
              </p>

            </div>

          </div>

        ))}

      </div>

    </div>
  );
}
