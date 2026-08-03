#!/bin/bash
# ==============================================================================
# Script: FFmpeg-Easy-Unraid (v6.2 - Clean Stats Fix)
# Author: metronade
# ==============================================================================

shopt -s nullglob

# --- GLOBAL VARS ---
METHOD="${ENCODE_METHOD:-intel_h265}"
CUSTOM_ARGS="${FFMPEG_CUSTOM_ARGS:-}"
MAP_ARGS="${ENCODE_MAP_ARGS:--map 0}"
PARALLEL_JOBS_INPUT="${ENCODE_PARALLEL_JOBS:-1}"
WATCH_MODE_INPUT="${ENCODE_WATCH_MODE:-0}"
WATCH_POLL_SECONDS_INPUT="${ENCODE_WATCH_POLL_SECONDS:-30}"
FILE_STABLE_SECONDS_INPUT="${ENCODE_FILE_STABLE_SECONDS:-5}"
LIVE_PREVIEW_INPUT="${ENCODE_LIVE_PREVIEW:-1}"
PROGRESS_INTERVAL_INPUT="${ENCODE_PROGRESS_INTERVAL:-2}"
HEARTBEAT_SECONDS_INPUT="${ENCODE_HEARTBEAT_SECONDS:-10}"
LOG_MODE_INPUT="${ENCODE_LOG_MODE:-detailed}"
BITRATE_MODE_INPUT="${ENCODE_BITRATE_MODE:-quality}"
PROGRESS_STYLE_INPUT="${ENCODE_PROGRESS_STYLE:-ascii}"
PROGRESS_COLOR_INPUT="${ENCODE_PROGRESS_COLOR:-auto}"

TARGET_UID="${UNRAID_UID:-99}"
TARGET_GID="${UNRAID_GID:-100}"

SOURCE_DIR="/import"
EXPORT_DIR="/export"
FINISHED_DIR="$SOURCE_DIR/finished"
LOG_FILE="$EXPORT_DIR/history.log"

QP_VALUE=""
FINAL_PARALLEL_JOBS=1
FINAL_WATCH_MODE=0
FINAL_WATCH_POLL_SECONDS=30
FINAL_FILE_STABLE_SECONDS=5
FINAL_LIVE_PREVIEW=1
FINAL_PROGRESS_INTERVAL=2
FINAL_HEARTBEAT_SECONDS=10
FINAL_LOG_MODE="detailed"
FINAL_BITRATE_MODE="quality"
FINAL_PROGRESS_STYLE="ascii"
FINAL_PROGRESS_COLOR=0
START_TIME=$SECONDS
SIZE_IN_TOTAL=0
SIZE_OUT_TOTAL=0

# ==============================================================================
# FUNCTIONS
# ==============================================================================

configure_settings() {
    if [ "$METHOD" != "intel_h265" ]; then
        echo "[WARN] ENCODE_METHOD '$METHOD' is no longer supported. Using 'intel_h265'."
        METHOD="intel_h265"
    fi

    # A) Intel H.265 quality control
    QP_VALUE="${ENCODE_QP:-22}"

    # B) Parallel Job Count
    if [[ "$PARALLEL_JOBS_INPUT" =~ ^[0-9]+$ ]] && [ "$PARALLEL_JOBS_INPUT" -ge 1 ]; then
        FINAL_PARALLEL_JOBS="$PARALLEL_JOBS_INPUT"
    else
        echo "[WARN] Invalid ENCODE_PARALLEL_JOBS='$PARALLEL_JOBS_INPUT'. Falling back to 1."
        FINAL_PARALLEL_JOBS=1
    fi

    # C) Watch Mode
    case "${WATCH_MODE_INPUT,,}" in
        1|true|yes|on) FINAL_WATCH_MODE=1 ;;
        0|false|no|off|"") FINAL_WATCH_MODE=0 ;;
        *)
            echo "[WARN] Invalid ENCODE_WATCH_MODE='$WATCH_MODE_INPUT'. Falling back to 0."
            FINAL_WATCH_MODE=0
            ;;
    esac

    if [[ "$WATCH_POLL_SECONDS_INPUT" =~ ^[0-9]+$ ]] && [ "$WATCH_POLL_SECONDS_INPUT" -ge 5 ]; then
        FINAL_WATCH_POLL_SECONDS="$WATCH_POLL_SECONDS_INPUT"
    else
        echo "[WARN] Invalid ENCODE_WATCH_POLL_SECONDS='$WATCH_POLL_SECONDS_INPUT'. Falling back to 30."
        FINAL_WATCH_POLL_SECONDS=30
    fi

    # D) File Stability Gate (seconds with unchanged size before processing)
    if [[ "$FILE_STABLE_SECONDS_INPUT" =~ ^[0-9]+$ ]]; then
        FINAL_FILE_STABLE_SECONDS="$FILE_STABLE_SECONDS_INPUT"
    else
        echo "[WARN] Invalid ENCODE_FILE_STABLE_SECONDS='$FILE_STABLE_SECONDS_INPUT'. Falling back to 5."
        FINAL_FILE_STABLE_SECONDS=5
    fi

    # E) Live Preview Logging
    case "${LIVE_PREVIEW_INPUT,,}" in
        1|true|yes|on) FINAL_LIVE_PREVIEW=1 ;;
        0|false|no|off|"") FINAL_LIVE_PREVIEW=0 ;;
        *)
            echo "[WARN] Invalid ENCODE_LIVE_PREVIEW='$LIVE_PREVIEW_INPUT'. Falling back to 1."
            FINAL_LIVE_PREVIEW=1
            ;;
    esac

    if [[ "$PROGRESS_INTERVAL_INPUT" =~ ^[0-9]+$ ]] && [ "$PROGRESS_INTERVAL_INPUT" -ge 1 ]; then
        FINAL_PROGRESS_INTERVAL="$PROGRESS_INTERVAL_INPUT"
    else
        echo "[WARN] Invalid ENCODE_PROGRESS_INTERVAL='$PROGRESS_INTERVAL_INPUT'. Falling back to 2."
        FINAL_PROGRESS_INTERVAL=2
    fi

    # F) Heartbeat Interval for Live Preview
    if [[ "$HEARTBEAT_SECONDS_INPUT" =~ ^[0-9]+$ ]] && [ "$HEARTBEAT_SECONDS_INPUT" -ge 1 ]; then
        FINAL_HEARTBEAT_SECONDS="$HEARTBEAT_SECONDS_INPUT"
    else
        echo "[WARN] Invalid ENCODE_HEARTBEAT_SECONDS='$HEARTBEAT_SECONDS_INPUT'. Falling back to 10."
        FINAL_HEARTBEAT_SECONDS=10
    fi

    # G) Log Mode
    case "${LOG_MODE_INPUT,,}" in
        detailed|full) FINAL_LOG_MODE="detailed" ;;
        compact|quiet) FINAL_LOG_MODE="compact" ;;
        *)
            echo "[WARN] Invalid ENCODE_LOG_MODE='$LOG_MODE_INPUT'. Falling back to detailed."
            FINAL_LOG_MODE="detailed"
            ;;
    esac

    # H) Progress Bar Style
    case "${PROGRESS_STYLE_INPUT,,}" in
        ascii) FINAL_PROGRESS_STYLE="ascii" ;;
        unicode|blocks|block) FINAL_PROGRESS_STYLE="unicode" ;;
        *)
            echo "[WARN] Invalid ENCODE_PROGRESS_STYLE='$PROGRESS_STYLE_INPUT'. Falling back to ascii."
            FINAL_PROGRESS_STYLE="ascii"
            ;;
    esac

    # I) Progress Color
    case "${PROGRESS_COLOR_INPUT,,}" in
        1|true|yes|on) FINAL_PROGRESS_COLOR=1 ;;
        0|false|no|off) FINAL_PROGRESS_COLOR=0 ;;
        auto|"")
            if [ -t 1 ]; then
                FINAL_PROGRESS_COLOR=1
            else
                FINAL_PROGRESS_COLOR=0
            fi
            ;;
        *)
            echo "[WARN] Invalid ENCODE_PROGRESS_COLOR='$PROGRESS_COLOR_INPUT'. Falling back to auto."
            if [ -t 1 ]; then
                FINAL_PROGRESS_COLOR=1
            else
                FINAL_PROGRESS_COLOR=0
            fi
            ;;
    esac

    # J) Bitrate Mode
    case "${BITRATE_MODE_INPUT,,}" in
        quality) FINAL_BITRATE_MODE="quality" ;;
        source|source_bitrate) FINAL_BITRATE_MODE="source" ;;
        *)
            echo "[WARN] Invalid ENCODE_BITRATE_MODE='$BITRATE_MODE_INPUT'. Falling back to quality."
            FINAL_BITRATE_MODE="quality"
            ;;
    esac
}

check_paths() {
    echo "[INIT] Method: $METHOD | QP: $QP_VALUE | Parallel Jobs: $FINAL_PARALLEL_JOBS | Watch Mode: $FINAL_WATCH_MODE | Stable Seconds: $FINAL_FILE_STABLE_SECONDS | Live Preview: $FINAL_LIVE_PREVIEW | Log Mode: $FINAL_LOG_MODE | Bitrate Mode: $FINAL_BITRATE_MODE"
    if [ ! -d "$SOURCE_DIR" ]; then echo "[FATAL] /import missing."; exit 1; fi

    local r_src; r_src=$(realpath "$SOURCE_DIR")
    local r_exp; r_exp=$(realpath "$EXPORT_DIR")

    if [ "$r_src" == "$r_exp" ]; then echo "[FATAL] Input/Output paths identical."; exit 1; fi
    if [[ "$r_exp" == "$r_src"* ]]; then echo "[FATAL] Output is subdirectory of Input."; exit 1; fi
    
    mkdir -p "$EXPORT_DIR"
    mkdir -p "$FINISHED_DIR"
    chown "$TARGET_UID":"$TARGET_GID" "$FINISHED_DIR"
    touch "$LOG_FILE"
}

check_hardware() {
    local test_cmd="ffmpeg -y \
        -init_hw_device vaapi=va:/dev/dri/renderD128 \
        -filter_hw_device va \
        -vaapi_device /dev/dri/renderD128 \
        -f lavfi \
        -i color=c=black:s=128x128 \
        -vf 'format=nv12,hwupload' \
        -frames:v 1 \
        -c:v hevc_vaapi \
        -qp 22 \
        -f null -"

    if ! eval "$test_cmd" > /dev/null 2> /tmp/hw_check.log; then
        echo "[FATAL] Hardware check failed for '$METHOD'."
        echo "--------------------------------------------------------"
        echo "FFmpeg Error Output:"
        cat /tmp/hw_check.log
        echo "--------------------------------------------------------"
        echo "Hint: Ensure Intel iGPU device mapping (/dev/dri) is available to the container."
        exit 1
    fi
}

detect_video_metadata() {
    local input="$1"
    local probe=""
    local transfer=""
    local primaries=""
    local colorspace=""
    local color_range=""
    local bitrate=""

    probe=$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer,color_primaries,color_space,color_range,bit_rate,pix_fmt -of csv=p=0 "$input" 2>/dev/null | head -n1)
    IFS=',' read -r transfer primaries colorspace color_range bitrate _ <<< "$probe"

    transfer=$(echo "$transfer" | tr '[:upper:]' '[:lower:]')
    primaries=$(echo "$primaries" | tr '[:upper:]' '[:lower:]')
    colorspace=$(echo "$colorspace" | tr '[:upper:]' '[:lower:]')
    color_range=$(echo "$color_range" | tr '[:upper:]' '[:lower:]')

    if [ "$color_range" = "unknown" ] || [ "$color_range" = "n/a" ]; then
        color_range=""
    fi
    if [ "$bitrate" = "N/A" ] || [ "$bitrate" = "n/a" ]; then
        bitrate=""
    fi

    if [ "$transfer" = "smpte2084" ] || [ "$transfer" = "arib-std-b67" ]; then
        if [ -z "$primaries" ] || [ "$primaries" = "unknown" ]; then
            primaries="bt2020"
        fi
        if [ -z "$colorspace" ] || [ "$colorspace" = "unknown" ]; then
            colorspace="bt2020nc"
        fi
        echo "1|$transfer|$primaries|$colorspace|$color_range|$bitrate"
    else
        echo "0||||$color_range|$bitrate"
    fi
}

get_ffmpeg_cmd() {
    local input="$1"; local output="$2"
    local hdr_flag="${3:-0}"
    local hdr_transfer="$4"
    local hdr_primaries="$5"
    local hdr_colorspace="$6"
    local source_color_range="$7"
    local bitrate_mode="$8"
    local source_bitrate="$9"
    local cmd_prefix=(ffmpeg -hide_banner -y)
    local audio_sub_args="${CUSTOM_ARGS:--c:a copy -c:s copy}"
    
    local intel_filter="format=nv12,hwupload"
    local intel_hdr_args=""
    local intel_sdr_args=""
    local color_range_args=""
    local rate_control_args=""

    if [ "$FINAL_LIVE_PREVIEW" -eq 1 ]; then
        cmd_prefix+=(-loglevel warning -stats_period "$FINAL_PROGRESS_INTERVAL" -progress pipe:2 -nostats)
    else
        cmd_prefix+=(-loglevel error -stats)
    fi

    if [ "$source_color_range" = "tv" ] || [ "$source_color_range" = "pc" ]; then
        color_range_args="-color_range $source_color_range"
    fi

    if [ "$bitrate_mode" = "source" ] && [[ "$source_bitrate" =~ ^[0-9]+$ ]] && [ "$source_bitrate" -gt 0 ]; then
        rate_control_args="-b:v $source_bitrate"
    fi

    intel_sdr_args="$color_range_args"

    if [ "$hdr_flag" -eq 1 ]; then
        intel_filter="format=p010le,hwupload"
        intel_hdr_args="-profile:v main10 -color_primaries $hdr_primaries -color_trc $hdr_transfer -colorspace $hdr_colorspace $color_range_args"
    fi

    local intel_color_args="$intel_sdr_args"
    [ "$hdr_flag" -eq 1 ] && intel_color_args="$intel_hdr_args"

    local intel_rate_args="$rate_control_args"
    [ -z "$intel_rate_args" ] && intel_rate_args="-qp $QP_VALUE"

    echo "${cmd_prefix[@]} -init_hw_device vaapi=va:/dev/dri/renderD128 -filter_hw_device va -vaapi_device /dev/dri/renderD128 -i \"$input\" $MAP_ARGS -vf \"$intel_filter\" -c:v hevc_vaapi $intel_color_args $intel_rate_args $audio_sub_args \"$output\""
}

process_one_file() {
    local input_file="$1"
    local index="$2"
    local total="$3"
    local result_file="$4"
    local progress_status_file="$5"

    local rel_path="${input_file#$SOURCE_DIR/}"
    local fname_no_ext
    fname_no_ext="$(basename -- "$input_file" | sed 's/\.[^.]*$//')"
    local rel_dir
    rel_dir=$(dirname "$rel_path")

    local out_file="$EXPORT_DIR/$rel_dir/$fname_no_ext.mkv"
    local finish_dest="$FINISHED_DIR/$rel_path"
    local short_name="$fname_no_ext"
    if [ ${#short_name} -gt 48 ]; then
        short_name="${short_name:0:45}..."
    fi

    echo ""
    echo "[PROGRESS] File $index of $total"
    echo "[START] Processing: $fname_no_ext"

    mkdir -p "$(dirname "$out_file")"
    chown "$TARGET_UID":"$TARGET_GID" "$(dirname "$out_file")"
    [ -f "$out_file" ] && rm "$out_file"

    if ! wait_for_file_stable "$input_file"; then
        echo "[FAIL] Source became unavailable while waiting for stable copy: $rel_path"
        printf 'FAIL|0|0|%s\n' "$rel_path" > "$result_file"
        if [ -n "$progress_status_file" ]; then
            printf 'state=fail|index=%s|name=%s|pct=0.00|speed=n/a|elapsed=0|out=0\n' "$index" "$short_name" > "$progress_status_file"
        fi
        return
    fi

    local current_in_size
    current_in_size=$(stat -c%s "$input_file")

    local src_duration
    src_duration=$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$input_file" 2>/dev/null | head -n1)
    if ! [[ "$src_duration" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
        src_duration=""
    fi

    local VIDEO_META
    VIDEO_META=$(detect_video_metadata "$input_file")
    local IS_HDR HDR_TRANSFER HDR_PRIMARIES HDR_COLORSPACE SRC_COLOR_RANGE SRC_VIDEO_BITRATE
    IFS='|' read -r IS_HDR HDR_TRANSFER HDR_PRIMARIES HDR_COLORSPACE SRC_COLOR_RANGE SRC_VIDEO_BITRATE <<< "$VIDEO_META"
    local log_tag="[ENC $index/$total $fname_no_ext] "

    if [ "$IS_HDR" -eq 1 ]; then
        echo "[INFO] HDR source detected (transfer=$HDR_TRANSFER, primaries=$HDR_PRIMARIES, colorspace=$HDR_COLORSPACE). Preserving HDR signaling."
    fi
    if [ "$FINAL_BITRATE_MODE" = "source" ]; then
        if [[ "$SRC_VIDEO_BITRATE" =~ ^[0-9]+$ ]] && [ "$SRC_VIDEO_BITRATE" -gt 0 ]; then
            echo "${log_tag}Using source bitrate mode: ${SRC_VIDEO_BITRATE} bps"
        else
            echo "${log_tag}Source bitrate unavailable. Falling back to quality mode for this file."
        fi
    fi

    local CMD_STR
    CMD_STR=$(get_ffmpeg_cmd "$input_file" "$out_file" "$IS_HDR" "$HDR_TRANSFER" "$HDR_PRIMARIES" "$HDR_COLORSPACE" "$SRC_COLOR_RANGE" "$FINAL_BITRATE_MODE" "$SRC_VIDEO_BITRATE")

    local ff_ret=0
    local ff_err_log=""
    local ff_progress_log=""
    local can_inline_progress=0
    local can_use_color=0
    if [ -n "$progress_status_file" ]; then
        printf 'state=run|index=%s|name=%s|pct=0.00|speed=n/a|elapsed=0|out=0\n' "$index" "$short_name" > "$progress_status_file"
    fi
    if [ "$FINAL_LIVE_PREVIEW" -eq 1 ]; then
        echo "${log_tag}Starting ffmpeg encode..."
        local encode_start=$SECONDS
        ff_progress_log=$(mktemp /tmp/ffmpeg-progress.XXXXXX)
        local CMD_RUN_STR="$CMD_STR"
        CMD_RUN_STR=${CMD_RUN_STR/ -nostats/ -nostats -progress \"$ff_progress_log\"}
        if [ -t 1 ] && [ "$FINAL_PARALLEL_JOBS" -eq 1 ]; then
            can_inline_progress=1
        fi
        if [ -t 1 ] && [ "$FINAL_PROGRESS_COLOR" -eq 1 ]; then
            can_use_color=1
        fi

        if [ "$FINAL_LOG_MODE" = "compact" ]; then
            ff_err_log=$(mktemp /tmp/ffmpeg-err.XXXXXX)
            eval "$CMD_RUN_STR" 2> "$ff_err_log" &
        else
            eval "$CMD_RUN_STR" \
                2> >(awk -v p="$log_tag" '!/Failed to set thread priority|set_mempolicy/ { print p $0; fflush() }' >&2) &
        fi
        local ff_pid=$!

        while kill -0 "$ff_pid" 2>/dev/null; do
            sleep "$FINAL_HEARTBEAT_SECONDS"
            if kill -0 "$ff_pid" 2>/dev/null; then
                local elapsed=$((SECONDS - encode_start))
                local current_out_live_size=0
                if [ -f "$out_file" ]; then
                    current_out_live_size=$(stat -c%s "$out_file" 2>/dev/null || echo 0)
                fi

                local pct_display="--.--"
                local bar
                local speed_display="n/a"
                bar=$(render_progress_bar "$pct_display" 24)

                if [ -n "$ff_progress_log" ] && [ -f "$ff_progress_log" ]; then
                    local out_time_ms
                    out_time_ms=$(awk -F= '/^out_time_ms=/{v=$2} END{print v+0}' "$ff_progress_log" 2>/dev/null)
                    speed_display=$(awk -F= '/^speed=/{v=$2} END{print v}' "$ff_progress_log" 2>/dev/null)
                    [ -z "$speed_display" ] && speed_display="n/a"
                    speed_display=$(echo "$speed_display" | xargs)

                    if [ -n "$src_duration" ] && [[ "$out_time_ms" =~ ^[0-9]+$ ]] && [ "$out_time_ms" -ge 0 ]; then
                        pct_display=$(awk -v ms="$out_time_ms" -v d="$src_duration" 'BEGIN {
                            if (d <= 0) { printf "--.--"; exit }
                            p=(ms/1000000)/d*100
                            if (p < 0) p=0
                            if (p > 100) p=100
                            printf "%.2f", p
                        }')
                        bar=$(render_progress_bar "$pct_display" 24)
                    fi
                fi

                local decorated_bar="[${bar}]"
                local decorated_pct="${pct_display}%"
                if [ "$can_use_color" -eq 1 ]; then
                    local c_reset=$'\033[0m'
                    local c_bar=$'\033[36m'
                    local c_pct=$'\033[33m'
                    if [[ "$pct_display" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
                        if awk -v p="$pct_display" 'BEGIN { exit !(p >= 90) }'; then
                            c_pct=$'\033[32m'
                        elif awk -v p="$pct_display" 'BEGIN { exit !(p >= 60) }'; then
                            c_pct=$'\033[92m'
                        fi
                    fi
                    decorated_bar="${c_bar}[${bar}]${c_reset}"
                    decorated_pct="${c_pct}${pct_display}%${c_reset}"
                fi

                local progress_line="${log_tag}${decorated_bar} ${decorated_pct} | speed ${speed_display} | t=${elapsed}s | out $(format_bytes_dual "$current_out_live_size")"
                if [ -n "$progress_status_file" ]; then
                    printf 'state=run|index=%s|name=%s|pct=%s|speed=%s|elapsed=%s|out=%s\n' "$index" "$short_name" "$pct_display" "$speed_display" "$elapsed" "$current_out_live_size" > "$progress_status_file"
                elif [ "$can_inline_progress" -eq 1 ]; then
                    printf '\r\033[2K%s' "$progress_line"
                else
                    echo "$progress_line"
                fi
            fi
        done

        wait "$ff_pid"
        ff_ret=$?

        if [ "$can_inline_progress" -eq 1 ]; then
            printf '\n'
        fi

        if [ "$ff_ret" -ne 0 ] && [ "$FINAL_LOG_MODE" = "compact" ] && [ -n "$ff_err_log" ] && [ -f "$ff_err_log" ]; then
            echo "${log_tag}ffmpeg failed. Last log lines:"
            tail -n 40 "$ff_err_log" | awk -v p="$log_tag" '!/Failed to set thread priority|set_mempolicy/ { print p $0; fflush() }'
        fi

        if [ -n "$ff_err_log" ] && [ -f "$ff_err_log" ]; then
            rm -f "$ff_err_log"
        fi
        if [ -n "$ff_progress_log" ] && [ -f "$ff_progress_log" ]; then
            rm -f "$ff_progress_log"
        fi
    else
        eval "$CMD_STR 2> >(grep -v -e 'Failed to set thread priority' -e 'set_mempolicy' >&2)"
        ff_ret=$?
    fi

    if [ "$ff_ret" -eq 0 ]; then
        local current_out_size
        current_out_size=$(stat -c%s "$out_file")

        local file_in_txt file_out_txt file_saved_txt file_saved_pct
        file_in_txt=$(format_bytes_dual "$current_in_size")
        file_out_txt=$(format_bytes_dual "$current_out_size")
        file_saved_txt=$(awk -v i="$current_in_size" -v o="$current_out_size" 'BEGIN {
            diff = i - o;
            gb = diff / 1073741824;
            mb = diff / 1048576;
            printf "%.2f GB | %.2f MB", gb, mb
        }')
        if [ "$current_in_size" -gt 0 ]; then
            file_saved_pct=$(awk -v i="$current_in_size" -v o="$current_out_size" 'BEGIN { printf "%.2f", ((i-o)/i)*100 }')
        else
            file_saved_pct="0.00"
        fi

        echo "[DONE] Encoding success."
        echo "${log_tag}File stats: input=$file_in_txt | output=$file_out_txt | saved=$file_saved_txt (${file_saved_pct}%)"
        if [ -n "$progress_status_file" ]; then
            printf 'state=done|index=%s|name=%s|pct=100.00|speed=done|elapsed=0|out=%s\n' "$index" "$short_name" "$current_out_size" > "$progress_status_file"
        fi
        echo "DONE: $rel_path" >> "$LOG_FILE"
        chown "$TARGET_UID":"$TARGET_GID" "$out_file"
        chmod 666 "$out_file"

        echo "[MOVE] Source -> Finished"
        mkdir -p "$(dirname "$finish_dest")"
        chown "$TARGET_UID":"$TARGET_GID" "$(dirname "$finish_dest")"
        mv "$input_file" "$finish_dest"

        printf 'SUCCESS|%s|%s|%s\n' "$current_in_size" "$current_out_size" "$rel_path" > "$result_file"
    else
        echo "[FAIL] Error processing $rel_path"
        [ -f "$out_file" ] && rm "$out_file"
        if [ -n "$progress_status_file" ]; then
            printf 'state=fail|index=%s|name=%s|pct=0.00|speed=fail|elapsed=0|out=0\n' "$index" "$short_name" > "$progress_status_file"
        fi
        printf 'FAIL|%s|0|%s\n' "$current_in_size" "$rel_path" > "$result_file"
    fi
}

# FIX: Switch from 'bc' to 'awk' for proper formatting (0.48 instead of .48)
format_bytes_dual() {
    local bytes=$1
    if [ -z "$bytes" ] || [ "$bytes" -eq 0 ]; then echo "0.00 GB | 0.00 MB"; return; fi
    
    # Use awk to calculate and format with 2 decimals and leading zeros
    local gb=$(awk -v b="$bytes" 'BEGIN { printf "%.2f", b/1073741824 }')
    local mb=$(awk -v b="$bytes" 'BEGIN { printf "%.2f", b/1048576 }')
    
    echo "${gb} GB | ${mb} MB"
}

render_progress_bar() {
    local percent="$1"
    local width="${2:-24}"

    local filled
    filled=$(awk -v p="$percent" -v w="$width" 'BEGIN {
        if (p < 0) p = 0;
        if (p > 100) p = 100;
        printf "%d", (p/100)*w
    }')

    local empty=$((width - filled))
    local fill_char="#"
    local empty_char="-"
    local bar=""

    if [ "$FINAL_PROGRESS_STYLE" = "unicode" ]; then
        fill_char="█"
        empty_char="░"
    fi

    bar="$(repeat_char "$fill_char" "$filled")$(repeat_char "$empty_char" "$empty")"

    echo "$bar"
}

repeat_char() {
    local char="$1"
    local count="$2"
    local out=""

    while [ "$count" -gt 0 ]; do
        out+="$char"
        count=$((count - 1))
    done

    echo "$out"
}

render_parallel_dashboard() {
    local progress_dir="$1"
    local stop_file="$2"
    local previous_lines=0

    while true; do
        local display_lines=()
        local status_files=("$progress_dir"/*.status)

        if [ -e "${status_files[0]}" ]; then
            local status_file
            for status_file in $(ls "$progress_dir"/*.status 2>/dev/null | sort -V); do
                local line
                line=$(cat "$status_file" 2>/dev/null)
                [ -z "$line" ] && continue

                local state="" idx="" name="" pct="0.00" speed="n/a" elapsed="0" out_bytes="0"
                local part
                IFS='|' read -r -a fields <<< "$line"
                for part in "${fields[@]}"; do
                    case "$part" in
                        state=*) state="${part#state=}" ;;
                        index=*) idx="${part#index=}" ;;
                        name=*) name="${part#name=}" ;;
                        pct=*) pct="${part#pct=}" ;;
                        speed=*) speed="${part#speed=}" ;;
                        elapsed=*) elapsed="${part#elapsed=}" ;;
                        out=*) out_bytes="${part#out=}" ;;
                    esac
                done

                local bar
                bar=$(render_progress_bar "$pct" 24)
                local status_tag="RUN"
                [ "$state" = "done" ] && status_tag="DONE"
                [ "$state" = "fail" ] && status_tag="FAIL"
                local out_txt
                out_txt=$(format_bytes_dual "$out_bytes")
                display_lines+=("[${status_tag}] [${bar}] ${pct}% | ${name} | speed ${speed} | t=${elapsed}s | out ${out_txt}")
            done
        fi

        if [ "$previous_lines" -gt 0 ]; then
            printf '\033[%sA' "$previous_lines"
        fi

        local printed=0
        local dline
        for dline in "${display_lines[@]}"; do
            printf '\033[2K\r%s\n' "$dline"
            ((printed++))
        done
        while [ "$printed" -lt "$previous_lines" ]; do
            printf '\033[2K\r\n'
            ((printed++))
        done

        previous_lines=${#display_lines[@]}

        if [ -f "$stop_file" ]; then
            break
        fi

        sleep 1
    done
}

wait_for_file_stable() {
    local file="$1"

    if [ "$FINAL_FILE_STABLE_SECONDS" -le 0 ]; then
        return 0
    fi

    local stable_count=0
    local last_size=""
    local current_size=""

    echo "[WATCH] Waiting for stable file: $(basename -- "$file") (${FINAL_FILE_STABLE_SECONDS}s unchanged size)"

    while true; do
        if [ ! -f "$file" ]; then
            return 1
        fi

        current_size=$(stat -c%s "$file" 2>/dev/null || true)
        if [ -z "$current_size" ]; then
            return 1
        fi

        if [ "$current_size" = "$last_size" ]; then
            ((stable_count++))
        else
            stable_count=0
            last_size="$current_size"
        fi

        if [ "$stable_count" -ge "$FINAL_FILE_STABLE_SECONDS" ]; then
            return 0
        fi

        sleep 1
    done
}

scan_files() {
    local files=()
    while IFS= read -r -d '' file; do
        files+=("$file")
    done < <(find "$SOURCE_DIR" -path "$FINISHED_DIR" -prune -o -type f \( -iname "*.mkv" -o -iname "*.mp4" -o -iname "*.ts" -o -iname "*.m2ts" -o -iname "*.avi" -o -iname "*.mov" -o -iname "*.wmv" \) -print0)

    printf '%s\0' "${files[@]}"
}

wait_for_new_files() {
    if command -v inotifywait >/dev/null 2>&1; then
        echo "[WATCH] Waiting for new files in '$SOURCE_DIR' (inotify)..."
        # Trigger only when a write is closed or a fully written file is moved into place.
        inotifywait -qq -r -e close_write -e moved_to --exclude '/finished(/|$)' "$SOURCE_DIR" || true
    else
        echo "[WATCH] inotifywait not found. Polling every $FINAL_WATCH_POLL_SECONDS seconds..."
        sleep "$FINAL_WATCH_POLL_SECONDS"
    fi
}

run_batch_once() {
    local files=()
    while IFS= read -r -d '' file; do
        files+=("$file")
    done < <(scan_files)

    local total_files=${#files[@]}

    if [ "$total_files" -eq 0 ]; then
        echo "[INFO] No files found."
        return 0
    fi

    echo "[INFO] Found $total_files files to process."
    echo "--------------------------------------------------------"

    local count_success=0
    local count_failed=0
    local current_index=0
    local size_in_total=0
    local size_out_total=0
    local result_dir
    local batch_start=$SECONDS
    result_dir=$(mktemp -d /tmp/ffmpeg-easy-results.XXXXXX)
    local progress_dir="$result_dir/progress"
    local progress_stop_file="$result_dir/progress.stop"
    local renderer_pid=""

    mkdir -p "$progress_dir"

    if [ "$FINAL_PARALLEL_JOBS" -gt 1 ] && [ "$FINAL_LIVE_PREVIEW" -eq 1 ] && [ -t 1 ]; then
        echo "[INFO] Parallel dashboard enabled (${FINAL_PARALLEL_JOBS} jobs)."
        render_parallel_dashboard "$progress_dir" "$progress_stop_file" &
        renderer_pid=$!
    fi

    for input_file in "${files[@]}"; do
        ((current_index++))
        if [ "$FINAL_PARALLEL_JOBS" -le 1 ]; then
            process_one_file "$input_file" "$current_index" "$total_files" "$result_dir/$current_index.result"
        else
            local progress_status_file="$progress_dir/$current_index.status"
            process_one_file "$input_file" "$current_index" "$total_files" "$result_dir/$current_index.result" "$progress_status_file" &
            while [ "$(jobs -rp | wc -l)" -ge "$FINAL_PARALLEL_JOBS" ]; do
                wait -n
            done
        fi
    done

    if [ "$FINAL_PARALLEL_JOBS" -gt 1 ]; then
        wait
    fi

    if [ -n "$renderer_pid" ]; then
        touch "$progress_stop_file"
        wait "$renderer_pid" 2>/dev/null || true
    fi

    for result in "$result_dir"/*.result; do
        [ -f "$result" ] || continue
        IFS='|' read -r status in_size out_size rel_path < "$result"

        if [ "$status" = "SUCCESS" ]; then
            ((count_success++))
            size_in_total=$(echo "$size_in_total + $in_size" | bc)
            size_out_total=$(echo "$size_out_total + $out_size" | bc)
        else
            ((count_failed++))
        fi
    done

    rm -rf "$result_dir"

    local duration=$((SECONDS - batch_start))
    local h=$((duration/3600))
    local m=$(((duration%3600)/60))
    local s=$((duration%60))

    echo ""
    echo "========================================================"
    echo " FINAL STATISTICS"
    echo "========================================================"
    echo " Processed:  $count_success (Failed: $count_failed)"
    echo " Runtime:    ${h}h ${m}m ${s}s"
    if [ $count_success -gt 0 ]; then
        local txt_in txt_out txt_diff percent
        txt_in=$(format_bytes_dual "$size_in_total")
        txt_out=$(format_bytes_dual "$size_out_total")
        txt_diff=$(awk -v i="$size_in_total" -v o="$size_out_total" 'BEGIN {
            diff = i - o;
            gb = diff / 1073741824;
            mb = diff / 1048576;
            printf "%.2f GB | %.2f MB", gb, mb
        }')
        percent=$(awk "BEGIN {printf \"%.2f\", (($size_in_total-$size_out_total)/$size_in_total)*100}")

        echo " Input:      $txt_in"
        echo " Output:     $txt_out"
        echo " Saved:      $txt_diff ($percent%)"
    fi
    echo "========================================================"

    return 0
}

# ==============================================================================
# MAIN
# ==============================================================================

configure_settings
check_paths
check_hardware

echo "--------------------------------------------------------"
echo "[INFO] Scanning '/import' for video files... Please wait."

if [ "$FINAL_WATCH_MODE" -eq 1 ]; then
    echo "[WATCH] Continuous mode enabled."
    while true; do
        run_batch_once
        wait_for_new_files
    done
else
    run_batch_once
fi

exit 0
