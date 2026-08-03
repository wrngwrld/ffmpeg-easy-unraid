#!/bin/bash
# ==============================================================================
# Script: FFmpeg-Easy-Unraid (v6.2 - Clean Stats Fix)
# Author: metronade
# ==============================================================================

shopt -s nullglob

# --- GLOBAL VARS ---
METHOD="${ENCODE_METHOD:-cpu_h265}"
THREADS_INPUT="${ENCODE_THREADS:-0}"
PRESET_INPUT="${ENCODE_PRESET:-default}"
CUSTOM_ARGS="${FFMPEG_CUSTOM_ARGS:-}"
MAP_ARGS="${ENCODE_MAP_ARGS:--map 0}"
PARALLEL_JOBS_INPUT="${ENCODE_PARALLEL_JOBS:-1}"
WATCH_MODE_INPUT="${ENCODE_WATCH_MODE:-0}"
WATCH_POLL_SECONDS_INPUT="${ENCODE_WATCH_POLL_SECONDS:-30}"

TARGET_UID="${UNRAID_UID:-99}"
TARGET_GID="${UNRAID_GID:-100}"

SOURCE_DIR="/import"
EXPORT_DIR="/export"
FINISHED_DIR="$SOURCE_DIR/finished"
LOG_FILE="$EXPORT_DIR/history.log"

CRF_VALUE=""
CQ_VALUE=""
QP_VALUE=""
PRESET=""
FINAL_THREADS=0
FINAL_PARALLEL_JOBS=1
FINAL_WATCH_MODE=0
FINAL_WATCH_POLL_SECONDS=30
START_TIME=$SECONDS
SIZE_IN_TOTAL=0
SIZE_OUT_TOTAL=0

# ==============================================================================
# FUNCTIONS
# ==============================================================================

configure_settings() {
    # A) Smart Defaults: CRF/CQ
    if [ -z "$ENCODE_CRF" ] && [ -z "$ENCODE_CQ" ]; then
        if [[ "$METHOD" == *"av1"* ]]; then
            CRF_VALUE=24; CQ_VALUE=24
        else
            CRF_VALUE=18; CQ_VALUE=19
        fi
    else
        CRF_VALUE="${ENCODE_CRF:-18}"
        CQ_VALUE="${ENCODE_CQ:-19}"
    fi

    QP_VALUE="${ENCODE_QP:-22}"

    # B) Smart Defaults: Preset
    if [ "$PRESET_INPUT" == "default" ]; then
        if [[ "$METHOD" == *"nvidia"* ]]; then PRESET="p4";
        elif [[ "$METHOD" == *"cpu_av1"* ]]; then PRESET="8";
        else PRESET="medium"; fi
    else
        PRESET="$PRESET_INPUT"
    fi

    # C) CPU Safety & Thread Logic
    local host_cores=$(nproc --all)
    local container_cores=$(nproc)
    local pinning_active=0
    
    if [ "$container_cores" -lt "$host_cores" ]; then
        pinning_active=1
    fi

    if [ "$THREADS_INPUT" -eq 0 ] && [[ "$METHOD" == *"cpu"* ]]; then
        if [ "$pinning_active" -eq 1 ]; then
            echo "[INIT] CPU Pinning detected ($container_cores assigned). Using max performance."
            FINAL_THREADS=0 
        else
            local safe_limit=$((host_cores / 2))
            [ "$safe_limit" -lt 1 ] && safe_limit=1
            echo "[INIT] NO Pinning detected (Seen $host_cores cores)."
            echo "[CONFIRM] SAFETY MODE Active: Limiting to $safe_limit threads (50%)."
            FINAL_THREADS=$safe_limit
        fi
    else
        FINAL_THREADS="$THREADS_INPUT"
        if [[ "$METHOD" == *"cpu"* ]]; then
            if [ "$pinning_active" -eq 0 ] && [ "$FINAL_THREADS" -gt 0 ]; then
                 echo "[INIT] NO Pinning detected."
                 echo "[CONFIRM] Manual Limit Active: Using $FINAL_THREADS threads."
            elif [ "$pinning_active" -eq 1 ] && [ "$FINAL_THREADS" -gt 0 ]; then
                 echo "[CONFIRM] Pinning + Manual Limit: Using $FINAL_THREADS threads."
            fi
        fi
    fi

    # D) Parallel Job Count
    if [[ "$PARALLEL_JOBS_INPUT" =~ ^[0-9]+$ ]] && [ "$PARALLEL_JOBS_INPUT" -ge 1 ]; then
        FINAL_PARALLEL_JOBS="$PARALLEL_JOBS_INPUT"
    else
        echo "[WARN] Invalid ENCODE_PARALLEL_JOBS='$PARALLEL_JOBS_INPUT'. Falling back to 1."
        FINAL_PARALLEL_JOBS=1
    fi

    # E) Watch Mode
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
}

check_paths() {
    echo "[INIT] Method: $METHOD | Preset: $PRESET | CRF/CQ: $CRF_VALUE/$CQ_VALUE | Parallel Jobs: $FINAL_PARALLEL_JOBS | Watch Mode: $FINAL_WATCH_MODE"
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
    # Refresh library cache for Nvidia
    ldconfig > /dev/null 2>&1

    local test_cmd=""
    # FIX: Increased test resolution from 64x64 to 128x128
    case "$METHOD" in
        "nvidia_"*) test_cmd="ffmpeg -y -f lavfi -i color=c=black:s=128x128 -vframes 1 -c:v hevc_nvenc -f null -" ;;
        "intel_"*) test_cmd="ffmpeg -y \
        -init_hw_device vaapi=va:/dev/dri/renderD128 \
        -filter_hw_device va \
        -vaapi_device /dev/dri/renderD128 \
        -f lavfi \
        -i color=c=black:s=128x128 \
        -vf 'format=nv12,hwupload' \
        -frames:v 1 \
        -c:v hevc_vaapi \
        -qp 22 \
        -f null -" ;;      
        *)          test_cmd="true" ;;
    esac

    if ! eval "$test_cmd" > /dev/null 2> /tmp/hw_check.log; then
        echo "[FATAL] Hardware check failed for '$METHOD'."
        echo "--------------------------------------------------------"
        echo "FFmpeg Error Output:"
        cat /tmp/hw_check.log
        echo "--------------------------------------------------------"
        echo "Hint: If using Nvidia, ensure drivers are up to date on host."
        exit 1
    fi
}

detect_hdr_metadata() {
    local input="$1"
    local probe=""
    local transfer=""
    local primaries=""
    local colorspace=""

    probe=$(ffprobe -v error -select_streams v:0 -show_entries stream=color_transfer,color_primaries,color_space,pix_fmt -of csv=p=0 "$input" 2>/dev/null | head -n1)
    IFS=',' read -r transfer primaries colorspace _ <<< "$probe"

    transfer=$(echo "$transfer" | tr '[:upper:]' '[:lower:]')
    primaries=$(echo "$primaries" | tr '[:upper:]' '[:lower:]')
    colorspace=$(echo "$colorspace" | tr '[:upper:]' '[:lower:]')

    if [ "$transfer" = "smpte2084" ] || [ "$transfer" = "arib-std-b67" ]; then
        if [ -z "$primaries" ] || [ "$primaries" = "unknown" ]; then
            primaries="bt2020"
        fi
        if [ -z "$colorspace" ] || [ "$colorspace" = "unknown" ]; then
            colorspace="bt2020nc"
        fi
        echo "1|$transfer|$primaries|$colorspace"
    else
        echo "0|||"
    fi
}

get_ffmpeg_cmd() {
    local input="$1"; local output="$2"
    local hdr_flag="${3:-0}"
    local hdr_transfer="$4"
    local hdr_primaries="$5"
    local hdr_colorspace="$6"
    local cmd_prefix=(ffmpeg -hide_banner -loglevel error -stats -y)
    local audio_sub_args="${CUSTOM_ARGS:--c:a copy -c:s copy}"
    
    local x265_safe_arg=""
    local generic_thread_arg=""
    local intel_filter="format=nv12,hwupload"
    local intel_hdr_args=""
    local nvidia_av1_hdr_args=""
    local nvidia_h265_hdr_args=""
    local cpu_av1_hdr_args=""
    local x265_hdr_args=""

    if [ "$FINAL_THREADS" -gt 0 ]; then
        x265_safe_arg="-x265-params pools=$FINAL_THREADS"
        generic_thread_arg="-threads $FINAL_THREADS"
    fi

    if [ "$hdr_flag" -eq 1 ]; then
        intel_filter="format=p010le,hwupload"
        intel_hdr_args="-profile:v main10 -color_primaries $hdr_primaries -color_trc $hdr_transfer -colorspace $hdr_colorspace"
        nvidia_av1_hdr_args="-pix_fmt p010le -color_primaries $hdr_primaries -color_trc $hdr_transfer -colorspace $hdr_colorspace"
        nvidia_h265_hdr_args="-profile:v main10 -pix_fmt p010le -color_primaries $hdr_primaries -color_trc $hdr_transfer -colorspace $hdr_colorspace"
        cpu_av1_hdr_args="-pix_fmt yuv420p10le -color_primaries $hdr_primaries -color_trc $hdr_transfer -colorspace $hdr_colorspace"
        x265_hdr_args="-pix_fmt yuv420p10le -color_primaries $hdr_primaries -color_trc $hdr_transfer -colorspace $hdr_colorspace"
    fi

    case "$METHOD" in
        "nvidia_av1")  echo "${cmd_prefix[@]} -hwaccel cuda -hwaccel_output_format cuda -i \"$input\" $MAP_ARGS -c:v av1_nvenc $nvidia_av1_hdr_args -cq $CQ_VALUE -preset $PRESET $audio_sub_args \"$output\"" ;;
        "nvidia_h265") echo "${cmd_prefix[@]} -hwaccel cuda -hwaccel_output_format cuda -i \"$input\" $MAP_ARGS -c:v hevc_nvenc $nvidia_h265_hdr_args -cq $CQ_VALUE -preset $PRESET $audio_sub_args \"$output\"" ;;
        "intel_av1")
        echo "[FATAL] Intel AV1 encoding not supported by this GPU."
        return 1
        ;;
        "intel_h265")
        echo "${cmd_prefix[@]} -init_hw_device vaapi=va:/dev/dri/renderD128 -filter_hw_device va -vaapi_device /dev/dri/renderD128 -i \"$input\" $MAP_ARGS -vf \"$intel_filter\" -c:v hevc_vaapi $intel_hdr_args -qp $QP_VALUE $audio_sub_args \"$output\""
        ;;
        "cpu_av1")     echo "${cmd_prefix[@]} -i \"$input\" $generic_thread_arg $MAP_ARGS -c:v libsvtav1 $cpu_av1_hdr_args -crf $CRF_VALUE -preset $PRESET $audio_sub_args \"$output\"" ;;
        *)             echo "${cmd_prefix[@]} -i \"$input\" $x265_safe_arg $MAP_ARGS -c:v libx265 $x265_hdr_args -crf $CRF_VALUE -preset $PRESET $audio_sub_args \"$output\"" ;;
    esac
}

process_one_file() {
    local input_file="$1"
    local index="$2"
    local total="$3"
    local result_file="$4"

    local rel_path="${input_file#$SOURCE_DIR/}"
    local fname_no_ext
    fname_no_ext="$(basename -- "$input_file" | sed 's/\.[^.]*$//')"
    local rel_dir
    rel_dir=$(dirname "$rel_path")

    local out_file="$EXPORT_DIR/$rel_dir/$fname_no_ext.mkv"
    local finish_dest="$FINISHED_DIR/$rel_path"

    echo ""
    echo "[PROGRESS] File $index of $total"
    echo "[START] Processing: $fname_no_ext"

    mkdir -p "$(dirname "$out_file")"
    chown "$TARGET_UID":"$TARGET_GID" "$(dirname "$out_file")"
    [ -f "$out_file" ] && rm "$out_file"

    local current_in_size
    current_in_size=$(stat -c%s "$input_file")

    local HDR_META
    HDR_META=$(detect_hdr_metadata "$input_file")
    local IS_HDR HDR_TRANSFER HDR_PRIMARIES HDR_COLORSPACE
    IFS='|' read -r IS_HDR HDR_TRANSFER HDR_PRIMARIES HDR_COLORSPACE <<< "$HDR_META"

    if [ "$IS_HDR" -eq 1 ]; then
        echo "[INFO] HDR source detected (transfer=$HDR_TRANSFER, primaries=$HDR_PRIMARIES, colorspace=$HDR_COLORSPACE). Preserving HDR signaling."
    fi

    local CMD_STR
    CMD_STR=$(get_ffmpeg_cmd "$input_file" "$out_file" "$IS_HDR" "$HDR_TRANSFER" "$HDR_PRIMARIES" "$HDR_COLORSPACE")

    eval "$CMD_STR 2> >(grep -v -e 'Failed to set thread priority' -e 'set_mempolicy' >&2)"

    if [ $? -eq 0 ]; then
        local current_out_size
        current_out_size=$(stat -c%s "$out_file")

        echo "[DONE] Encoding success."
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
        inotifywait -qq -r -e create -e close_write -e moved_to --exclude '/finished(/|$)' "$SOURCE_DIR" || true
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

    for input_file in "${files[@]}"; do
        ((current_index++))
        if [ "$FINAL_PARALLEL_JOBS" -le 1 ]; then
            process_one_file "$input_file" "$current_index" "$total_files" "$result_dir/$current_index.result"
        else
            process_one_file "$input_file" "$current_index" "$total_files" "$result_dir/$current_index.result" &
            while [ "$(jobs -rp | wc -l)" -ge "$FINAL_PARALLEL_JOBS" ]; do
                wait -n
            done
        fi
    done

    if [ "$FINAL_PARALLEL_JOBS" -gt 1 ]; then
        wait
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
