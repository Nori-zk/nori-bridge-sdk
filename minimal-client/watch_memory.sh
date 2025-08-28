#!/bin/bash
pid=1136427
while kill -0 $pid 2>/dev/null; do
    ts=$(date '+%Y-%m-%d %H:%M:%S')
    ps -p $pid -o pid,ppid,cmd,%mem,rss,vsz --no-headers \
    | awk -v t="$ts" '{rss=$5/1024/1024; vsz=$6/1024/1024; printf "%s PID:%s PPID:%s CMD:%s %%MEM:%s RSS:%.3fGiB VSZ:%.3fGiB\n", t,$1,$2,$3,$4,rss,vsz}' \
    >> mem_usage.log
    sleep 1
done