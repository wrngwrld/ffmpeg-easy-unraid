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

TARGET_UID="${UNRAID_UID:-99}"
TARGET_GID="${UNRAID_GID:-100}"

SOURCE_DIR="/import"
EXPORT_DIR="/export"
FINISHED_DIR="$SOURCE_DIR/finished"
ADMIN_CONFIG_DIR="$EXPORT_DIR/.ffmpeg-easy-admin"
ADMIN_RULES_FILE="$ADMIN_CONFIG_DIR/rules.json"
ADMIN_STATE_DIR="/tmp/ffmpeg-easy-admin"
ADMIN_PROGRESS_DIR="$ADMIN_STATE_DIR/progress"
ADMIN_STATUS_FILE="$ADMIN_STATE_DIR/status.json"

QP_VALUE=""
FINAL_PARALLEL_JOBS=1
FINAL_WATCH_MODE=0
FINAL_WATCH_POLL_SECONDS=30
FINAL_FILE_STABLE_SECONDS=5
FINAL_LIVE_PREVIEW=1
FINAL_PROGRESS_INTERVAL=2
FINAL_HEARTBEAT_SECONDS=10
START_TIME=$SECONDS
SIZE_IN_TOTAL=0
SIZE_OUT_TOTAL=0

# ==============================================================================
# FUNCTIONS
# ==============================================================================

admin_json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

admin_init_runtime() {
    mkdir -p "$ADMIN_PROGRESS_DIR"
    rm -f "$ADMIN_PROGRESS_DIR"/*.status "$ADMIN_STATE_DIR"/progress.stop
}

get_effective_qp_for_path() {
    local rel_path="$1"

    if [ ! -f "$ADMIN_RULES_FILE" ]; then
        printf '%s\n' "$QP_VALUE"
        return
    fi

    python3 - "$ADMIN_RULES_FILE" "$rel_path" "$QP_VALUE" <<'PY'
import json
import sys
from pathlib import PurePosixPath

rules_file = sys.argv[1]
relative_path = PurePosixPath(sys.argv[2].lstrip("/"))
default_qp = sys.argv[3]

try:
    with open(rules_file, "r", encoding="utf-8") as handle:
        payload = json.load(handle)
except (OSError, json.JSONDecodeError):
    print(default_qp)
    raise SystemExit(0)

rules = payload.get("rules", []) if isinstance(payload, dict) else []

for rule in rules:
    if not isinstance(rule, dict):
        continue

    prefix = str(rule.get("pathPrefix", "")).strip().strip("/")
    qp = rule.get("qp")
    if not prefix or not isinstance(qp, int):
        continue

    prefix_path = PurePosixPath(prefix)
    if relative_path == prefix_path or prefix_path in relative_path.parents:
        print(qp)
        raise SystemExit(0)

print(default_qp)
PY
}

admin_write_status() {
    local state="$1"
    local message="$2"
    local batch_total="${3:-0}"
    local batch_processed="${4:-0}"
    local batch_succeeded="${5:-0}"
    local batch_failed="${6:-0}"
    local escaped_message

    mkdir -p "$ADMIN_PROGRESS_DIR"
    escaped_message=$(admin_json_escape "$message")

    cat > "$ADMIN_STATUS_FILE" <<EOF
{
  "state": "${state}",
  "message": "${escaped_message}",
  "method": "${METHOD}",
  "qp": ${QP_VALUE:-0},
  "watchMode": ${FINAL_WATCH_MODE},
  "parallelJobs": ${FINAL_PARALLEL_JOBS},
  "livePreview": ${FINAL_LIVE_PREVIEW},
  "batchTotal": "${batch_total}",
  "batchProcessed": ${batch_processed},
  "batchSucceeded": ${batch_succeeded},
  "batchFailed": ${batch_failed},
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
}

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

}

check_paths() {
    echo "[INIT] Method: $METHOD | QP: $QP_VALUE | Parallel Jobs: $FINAL_PARALLEL_JOBS | Watch Mode: $FINAL_WATCH_MODE | Stable Seconds: $FINAL_FILE_STABLE_SECONDS | Live Preview: $FINAL_LIVE_PREVIEW"
    if [ ! -d "$SOURCE_DIR" ]; then echo "[FATAL] /import missing."; exit 1; fi

    local r_src; r_src=$(realpath "$SOURCE_DIR")
    local r_exp; r_exp=$(realpath "$EXPORT_DIR")

    if [ "$r_src" == "$r_exp" ]; then echo "[FATAL] Input/Output paths identical."; exit 1; fi
    if [[ "$r_exp" == "$r_src"* ]]; then echo "[FATAL] Output is subdirectory of Input."; exit 1; fi
    
    mkdir -p "$EXPORT_DIR"
    mkdir -p "$FINISHED_DIR"
    mkdir -p "$ADMIN_CONFIG_DIR"
    chown "$TARGET_UID":"$TARGET_GID" "$FINISHED_DIR"
    admin_init_runtime
    admin_write_status "starting" "Container initialized" 0 0 0 0
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

    probe=$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer,color_primaries,color_space,color_range,pix_fmt -of csv=p=0 "$input" 2>/dev/null | head -n1)
    IFS=',' read -r transfer primaries colorspace color_range _ <<< "$probe"

    transfer=$(echo "$transfer" | tr '[:upper:]' '[:lower:]')
    primaries=$(echo "$primaries" | tr '[:upper:]' '[:lower:]')
    colorspace=$(echo "$colorspace" | tr '[:upper:]' '[:lower:]')
    color_range=$(echo "$color_range" | tr '[:upper:]' '[:lower:]')

    if [ "$color_range" = "unknown" ] || [ "$color_range" = "n/a" ]; then
        color_range=""
    fi
    if [ "$transfer" = "smpte2084" ] || [ "$transfer" = "arib-std-b67" ]; then
        if [ -z "$primaries" ] || [ "$primaries" = "unknown" ]; then
            primaries="bt2020"
        fi
        if [ -z "$colorspace" ] || [ "$colorspace" = "unknown" ]; then
            colorspace="bt2020nc"
        fi
        echo "1|$transfer|$primaries|$colorspace|$color_range"
    else
        echo "0||||$color_range"
    fi
}

get_ffmpeg_cmd() {
    local input="$1"; local output="$2"
    local hdr_flag="${3:-0}"
    local hdr_transfer="$4"
    local hdr_primaries="$5"
    local hdr_colorspace="$6"
    local source_color_range="$7"
    local qp_override="${8:-$QP_VALUE}"
    local cmd_prefix=(ffmpeg -hide_banner -y)
    local audio_sub_args="${CUSTOM_ARGS:--c:a copy -c:s copy}"
    
    local intel_filter="format=nv12,hwupload"
    local intel_hdr_args=""
    local intel_sdr_args=""
    local color_range_args=""

    if [ "$FINAL_LIVE_PREVIEW" -eq 1 ]; then
        cmd_prefix+=(-loglevel warning -stats_period "$FINAL_PROGRESS_INTERVAL" -progress pipe:2 -nostats)
    else
        cmd_prefix+=(-loglevel error -stats)
    fi

    if [ "$source_color_range" = "tv" ] || [ "$source_color_range" = "pc" ]; then
        color_range_args="-color_range $source_color_range"
    fi

    intel_sdr_args="$color_range_args"

    if [ "$hdr_flag" -eq 1 ]; then
        intel_filter="format=p010le,hwupload"
        intel_hdr_args="-profile:v main10 -color_primaries $hdr_primaries -color_trc $hdr_transfer -colorspace $hdr_colorspace $color_range_args"
    fi

    local intel_color_args="$intel_sdr_args"
    [ "$hdr_flag" -eq 1 ] && intel_color_args="$intel_hdr_args"

    local intel_rate_args="-qp $qp_override"

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
    local IS_HDR HDR_TRANSFER HDR_PRIMARIES HDR_COLORSPACE SRC_COLOR_RANGE
    IFS='|' read -r IS_HDR HDR_TRANSFER HDR_PRIMARIES HDR_COLORSPACE SRC_COLOR_RANGE <<< "$VIDEO_META"
    local log_tag="[ENC $index/$total $fname_no_ext] "
    local effective_qp
    effective_qp=$(get_effective_qp_for_path "$rel_path")

    if [ "$IS_HDR" -eq 1 ]; then
        echo "[INFO] HDR source detected (transfer=$HDR_TRANSFER, primaries=$HDR_PRIMARIES, colorspace=$HDR_COLORSPACE). Preserving HDR signaling."
    fi
    if [ "$effective_qp" != "$QP_VALUE" ]; then
        echo "${log_tag}Using folder QP override: ${effective_qp}"
    fi
    
    local CMD_STR
    CMD_STR=$(get_ffmpeg_cmd "$input_file" "$out_file" "$IS_HDR" "$HDR_TRANSFER" "$HDR_PRIMARIES" "$HDR_COLORSPACE" "$SRC_COLOR_RANGE" "$effective_qp")

    local ff_ret=0
    local ff_err_log=""
    local ff_progress_log=""
    if [ -n "$progress_status_file" ]; then
        printf 'state=run|index=%s|name=%s|pct=0.00|speed=n/a|elapsed=0|out=0\n' "$index" "$short_name" > "$progress_status_file"
    fi
    if [ "$FINAL_LIVE_PREVIEW" -eq 1 ]; then
        echo "${log_tag}Starting ffmpeg encode..."
        local encode_start=$SECONDS
        ff_progress_log=$(mktemp /tmp/ffmpeg-progress.XXXXXX)
        local CMD_RUN_STR="$CMD_STR"
        CMD_RUN_STR=${CMD_RUN_STR/ -nostats/ -nostats -progress \"$ff_progress_log\"}
        ff_err_log=$(mktemp /tmp/ffmpeg-err.XXXXXX)
        eval "$CMD_RUN_STR" 2> "$ff_err_log" &
        local ff_pid=$!

        while kill -0 "$ff_pid" 2>/dev/null; do
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

                local progress_head="[ENC $index/$total]"
                local progress_line="${progress_head} [${bar}] ${pct_display}% | ${short_name} | speed ${speed_display} | t=${elapsed}s | out $(format_bytes_dual "$current_out_live_size")"
                if [ -n "$progress_status_file" ]; then
                    printf 'state=run|index=%s|name=%s|pct=%s|speed=%s|elapsed=%s|out=%s\n' "$index" "$short_name" "$pct_display" "$speed_display" "$elapsed" "$current_out_live_size" > "$progress_status_file"
                else
                    echo "$progress_line"
                fi
            fi

            sleep "$FINAL_HEARTBEAT_SECONDS"
        done

        wait "$ff_pid"
        ff_ret=$?

        if [ "$ff_ret" -ne 0 ] && [ -n "$ff_err_log" ] && [ -f "$ff_err_log" ]; then
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
    local fill_char="█"
    local empty_char="░"
    local bar=""

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

emit_parallel_progress_snapshots() {
    local progress_dir="$1"
    local stop_file="$2"
    local last_summary=""

    while true; do
        local status_files=("$progress_dir"/*.status)
        local summary=""

        if [ -e "${status_files[0]}" ]; then
            local status_file
            for status_file in $(ls "$progress_dir"/*.status 2>/dev/null | sort -V); do
                local line
                line=$(cat "$status_file" 2>/dev/null)
                [ -z "$line" ] && continue

                local state="" idx="" pct="0.00" speed="n/a"
                local part
                IFS='|' read -r -a fields <<< "$line"
                for part in "${fields[@]}"; do
                    case "$part" in
                        state=*) state="${part#state=}" ;;
                        index=*) idx="${part#index=}" ;;
                        pct=*) pct="${part#pct=}" ;;
                        speed=*) speed="${part#speed=}" ;;
                    esac
                done

                [ -z "$idx" ] && continue

                # Snapshot mode should focus on active work only.
                [ "$state" != "run" ] && continue

                local bar
                bar=$(render_progress_bar "$pct" 12)

                local pct_num="$pct"
                local pct_fmt="  0.00%"
                if [[ "$pct_num" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
                    pct_fmt=$(awk -v p="$pct_num" 'BEGIN { printf "%6.2f%%", p }')
                fi

                local speed_fmt="  n/a "
                if [[ "$speed" =~ ^[0-9]+([.][0-9]+)?x$ ]]; then
                    local speed_num="${speed%x}"
                    speed_fmt=$(awk -v s="$speed_num" 'BEGIN { printf "%5.2fx", s }')
                fi

                if [ -n "$summary" ]; then
                    summary+=" | "
                fi
                summary+=$(printf "#%02d RUN [%s] %s @%s" "$idx" "$bar" "$pct_fmt" "$speed_fmt")
            done
        fi

        if [ -n "$summary" ] && [ "$summary" != "$last_summary" ]; then
            echo "[PROGRESS] $summary"
            last_summary="$summary"
        fi

        if [ -f "$stop_file" ]; then
            break
        fi

        sleep "$FINAL_HEARTBEAT_SECONDS"
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

    local f
    for f in "${files[@]}"; do
        printf '%s\0' "$f"
    done
}

wait_for_new_files() {
    admin_write_status "watching" "Waiting for new files" "queue" 0 0 0
    if command -v inotifywait >/dev/null 2>&1; then
        echo "[WATCH] Waiting for new files in '$SOURCE_DIR' (inotify)..."
        # Wake on new folders too so the next pass can attach watches inside them.
        inotifywait -qq -r -e create -e close_write -e moved_to --exclude '/finished(/|$)' "$SOURCE_DIR" || true
    else
        echo "[WATCH] inotifywait not found. Polling every $FINAL_WATCH_POLL_SECONDS seconds..."
        sleep "$FINAL_WATCH_POLL_SECONDS"
    fi
}

wait_for_new_files_briefly() {
    if command -v inotifywait >/dev/null 2>&1; then
        inotifywait -qq -t 1 -r -e create -e close_write -e moved_to --exclude '/finished(/|$)' "$SOURCE_DIR" || true
    else
        sleep 1
    fi
}

run_batch_once() {
    local files=()
    if [ "$FINAL_WATCH_MODE" -ne 1 ]; then
        while IFS= read -r -d '' file; do
            [ -n "$file" ] && files+=("$file")
        done < <(scan_files)
    fi

    local total_files=${#files[@]}

    if [ "$FINAL_WATCH_MODE" -ne 1 ] && [ "$total_files" -eq 0 ]; then
        echo "[INFO] No files found."
        return 0
    fi

    if [ "$FINAL_WATCH_MODE" -ne 1 ]; then
        echo "[INFO] Found $total_files files to process."
        echo "--------------------------------------------------------"
    fi

    local count_success=0
    local count_failed=0
    local current_index=0
    local size_in_total=0
    local size_out_total=0
    local result_dir
    local batch_start=$SECONDS
    result_dir=$(mktemp -d /tmp/ffmpeg-easy-results.XXXXXX)
    local progress_dir="$ADMIN_PROGRESS_DIR"
    local progress_stop_file="$ADMIN_STATE_DIR/progress.stop"
    local renderer_pid=""

    admin_init_runtime

    if [ "$FINAL_PARALLEL_JOBS" -gt 1 ] && [ "$FINAL_LIVE_PREVIEW" -eq 1 ]; then
        echo "[INFO] Parallel snapshot mode enabled for non-interactive logs (${FINAL_PARALLEL_JOBS} jobs)."
        emit_parallel_progress_snapshots "$progress_dir" "$progress_stop_file" &
        renderer_pid=$!
    fi

    if [ "$FINAL_WATCH_MODE" -eq 1 ]; then
        local next_file=""
        local running_workers=0
        local work_started=0
        local total_label="queue"
        local started_in_pass=0
        declare -A seen_paths=()

        admin_write_status "watching" "Watching for queued files" "$total_label" 0 0 0

        while true; do
            started_in_pass=0
            if [ -n "$renderer_pid" ]; then
                running_workers=$(jobs -rp | awk -v rp="$renderer_pid" '$1 != rp' | wc -l)
            else
                running_workers=$(jobs -rp | wc -l)
            fi

            while [ "$running_workers" -lt "$FINAL_PARALLEL_JOBS" ]; do
                next_file=""
                while IFS= read -r -d '' file; do
                    [ -z "$file" ] && continue
                    if [ -z "${seen_paths[$file]+x}" ]; then
                        next_file="$file"
                        break
                    fi
                done < <(scan_files)

                [ -z "$next_file" ] && break

                ((current_index++))
                seen_paths["$next_file"]=1
                work_started=1
                started_in_pass=1
                admin_write_status "running" "Processing queued files" "$total_label" 0 "$count_success" "$count_failed"

                if [ "$FINAL_PARALLEL_JOBS" -le 1 ]; then
                    process_one_file "$next_file" "$current_index" "$total_label" "$result_dir/$current_index.result" &
                else
                    local progress_status_file="$progress_dir/$current_index.status"
                    process_one_file "$next_file" "$current_index" "$total_label" "$result_dir/$current_index.result" "$progress_status_file" &
                fi

                running_workers=$((running_workers + 1))
            done

            if [ "$work_started" -eq 0 ]; then
                echo "[INFO] No files found."
                admin_write_status "idle" "No files found" "$total_label" 0 0 0
                break
            fi

            if [ "$running_workers" -eq 0 ]; then
                break
            fi

            if [ "$running_workers" -lt "$FINAL_PARALLEL_JOBS" ] && [ "$started_in_pass" -eq 0 ]; then
                wait_for_new_files_briefly
                continue
            fi

            wait -n
        done
    else
        admin_write_status "running" "Processing batch" "$total_files" 0 0 0
        for input_file in "${files[@]}"; do
            ((current_index++))
            if [ "$FINAL_PARALLEL_JOBS" -le 1 ]; then
                process_one_file "$input_file" "$current_index" "$total_files" "$result_dir/$current_index.result"
            else
                local progress_status_file="$progress_dir/$current_index.status"
                process_one_file "$input_file" "$current_index" "$total_files" "$result_dir/$current_index.result" "$progress_status_file" &
                while true; do
                    local running_workers_batch
                    if [ -n "$renderer_pid" ]; then
                        running_workers_batch=$(jobs -rp | awk -v rp="$renderer_pid" '$1 != rp' | wc -l)
                    else
                        running_workers_batch=$(jobs -rp | wc -l)
                    fi

                    if [ "$running_workers_batch" -lt "$FINAL_PARALLEL_JOBS" ]; then
                        break
                    fi

                    wait -n
                done
            fi
        done

        if [ "$FINAL_PARALLEL_JOBS" -gt 1 ]; then
            while true; do
                local running_workers_batch
                if [ -n "$renderer_pid" ]; then
                    running_workers_batch=$(jobs -rp | awk -v rp="$renderer_pid" '$1 != rp' | wc -l)
                else
                    running_workers_batch=$(jobs -rp | wc -l)
                fi

                if [ "$running_workers_batch" -eq 0 ]; then
                    break
                fi

                wait -n
            done
        fi
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

        if [ "$FINAL_WATCH_MODE" -eq 1 ]; then
            admin_write_status "watching" "Waiting for new files" "queue" "$((count_success + count_failed))" "$count_success" "$count_failed"
        else
            admin_write_status "completed" "Batch finished" "$total_files" "$((count_success + count_failed))" "$count_success" "$count_failed"
        fi

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

        if scan_files | grep -q .; then
            echo "[WATCH] Additional files detected. Starting next batch immediately."
            continue
        fi

        wait_for_new_files
    done
else
    run_batch_once
fi

exit 0
