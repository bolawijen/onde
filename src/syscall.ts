export const SYS_READ          = 0x00;
export const SYS_WRITE         = 0x01;
export const SYS_OPEN          = 0x02;
export const SYS_CLOSE         = 0x03;
export const SYS_MMAP          = 0x09;
export const SYS_MUNMAP        = 0x0B;
export const SYS_WRITEV        = 0x14;
export const SYS_EXIT          = 0x3C;
export const SYS_CHMOD         = 0x5A;
export const SYS_CLOCK_GETTIME = 0xE4;

// mmap protection flags
export const PROT_NONE  = 0x0;
export const PROT_READ  = 0x1;
export const PROT_WRITE = 0x2;
export const PROT_EXEC  = 0x4;

// mmap map flags
export const MAP_SHARED    = 0x01;
export const MAP_PRIVATE   = 0x02;
export const MAP_ANONYMOUS = 0x20;

// POSIX clocks
export const CLOCK_REALTIME  = 0;
export const CLOCK_MONOTONIC = 1;

