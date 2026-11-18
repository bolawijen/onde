import { writeSync } from "fs";

export const ELF_CODE_OFFSET = 0xb0; // ELF64 header + two 56-byte program headers

export function writeHeader(fd: number, fileSize: number) {
  if (!Number.isInteger(fileSize) || fileSize < 0 || fileSize > 0xffffffff)
    throw new RangeError(`ELF file size out of range: ${fileSize}`);
  writeSync(fd, new Uint8Array([
    // ELF header
    0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x02, 0x00, 0x3e, 0x00, 0x01, 0x00, 0x00, 0x00,
    ELF_CODE_OFFSET, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x40, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x40, 0x00, 0x38, 0x00,
    0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,

    // program header
    0x01, 0, 0, 0,                 // p_type
    0x05, 0, 0, 0,                 // p_flags
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0,  // p_offset
    0x40, 0, 0, 0, 0, 0, 0, 0,     // p_vaddr
    0x40, 0, 0, 0, 0, 0,           // p_paddr
    fileSize & 0xff, (fileSize >> 8) & 0xff, (fileSize >> 16) & 0xff, (fileSize >> 24) & 0xff, 0, 0, 0, 0, // p_filesz
    fileSize & 0xff, (fileSize >> 8) & 0xff, (fileSize >> 16) & 0xff, (fileSize >> 24) & 0xff, 0, 0, 0, 0, // p_memsz
    0, 0x10, 0, 0, 0, 0, 0, 0,     // p_align = 0x1000

    // PT_GNU_STACK: readable + writable, never executable.
    0x51, 0xe5, 0x74, 0x64,         // p_type = PT_GNU_STACK
    0x06, 0, 0, 0,                  // p_flags = PF_R | PF_W
    0, 0, 0, 0, 0, 0, 0, 0,         // p_offset
    0, 0, 0, 0, 0, 0, 0, 0,         // p_vaddr
    0, 0, 0, 0, 0, 0, 0, 0,         // p_paddr
    0, 0, 0, 0, 0, 0, 0, 0,         // p_filesz
    0, 0, 0, 0, 0, 0, 0, 0,         // p_memsz
    0x10, 0, 0, 0, 0, 0, 0, 0,      // p_align = 16
  ]));
}
